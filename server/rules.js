const crypto = require('crypto');
const { load, save, LEVELS, STATUSES, FILE_TYPES, MAX_CODE_LENGTH, MAX_RULE_NAME_LENGTH, MAX_PATTERN_LENGTH, MAX_NOTE_LENGTH } = require('./store');
const { ApiError, pickText } = require('./errors');
const { scanCore } = require('./scan');

// 规则编码固定成大写字母加分段的数字，方便在命中清单里引用
const CODE_PATTERN = /^[A-Z]{2,6}-\d{2,4}$/;

function validateCode(value, data, selfId) {
  const code = pickText(value);
  if (!code) throw new ApiError(400, 'CODE_REQUIRED', '请填写规则编码', 'code');
  if (code.length > MAX_CODE_LENGTH) {
    throw new ApiError(400, 'CODE_TOO_LONG', `规则编码不能超过 ${MAX_CODE_LENGTH} 个字符`, 'code');
  }
  if (!CODE_PATTERN.test(code)) {
    throw new ApiError(400, 'CODE_INVALID', '规则编码要写成大写字母加短横线加数字，例如 CODE-001', 'code');
  }
  const hit = data.rules.find((item) => item.id !== selfId && item.code.toLowerCase() === code.toLowerCase());
  if (hit) throw new ApiError(409, 'CODE_DUPLICATED', `编码 ${hit.code} 已经被 ${hit.name} 用了`, 'code');
  return code;
}

function validateName(value) {
  const name = pickText(value);
  if (!name) throw new ApiError(400, 'NAME_REQUIRED', '请填写规则名称', 'name');
  if (name.length > MAX_RULE_NAME_LENGTH) {
    throw new ApiError(400, 'NAME_TOO_LONG', `规则名称不能超过 ${MAX_RULE_NAME_LENGTH} 个字符`, 'name');
  }
  return name;
}

function validatePattern(value) {
  const pattern = typeof value === 'string' ? value : '';
  if (!pattern.trim()) throw new ApiError(400, 'PATTERN_REQUIRED', '请填写要匹配的写法', 'pattern');
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new ApiError(400, 'PATTERN_TOO_LONG', `匹配写法不能超过 ${MAX_PATTERN_LENGTH} 个字符`, 'pattern');
  }
  return pattern;
}

function validateLevel(value) {
  const level = pickText(value);
  if (!level) return LEVELS[0];
  if (!LEVELS.includes(level)) {
    throw new ApiError(400, 'LEVEL_INVALID', `级别只能是 ${LEVELS.join('、')} 其中之一`, 'level');
  }
  return level;
}

function validateStatus(value) {
  const status = pickText(value);
  if (!status) return STATUSES[0];
  if (!STATUSES.includes(status)) {
    throw new ApiError(400, 'STATUS_INVALID', `状态只能是 ${STATUSES.join('、')} 其中之一`, 'status');
  }
  return status;
}

function validateFileType(value) {
  const fileType = pickText(value);
  if (!fileType) return FILE_TYPES[0];
  if (!FILE_TYPES.includes(fileType)) {
    throw new ApiError(400, 'FILE_TYPE_INVALID', `适用文件类型只能是 ${FILE_TYPES.join('、')} 其中之一`, 'fileType');
  }
  return fileType;
}

function validateNote(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ApiError(400, 'NOTE_INVALID', '说明需要是文本', 'note');
  if (value.length > MAX_NOTE_LENGTH) {
    throw new ApiError(400, 'NOTE_TOO_LONG', `说明不能超过 ${MAX_NOTE_LENGTH} 个字符`, 'note');
  }
  return value.trim();
}

function sortRules(list) {
  return list.slice().sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

// 规则清单：按级别、状态、适用文件类型筛选，再按编码、名称或匹配写法搜索
function listRules(options) {
  const input = options && typeof options === 'object' ? options : {};
  const level = pickText(input.level);
  const status = pickText(input.status);
  const fileType = pickText(input.fileType);
  const keyword = pickText(input.keyword).toLowerCase();
  const data = load();

  let list = data.rules;
  if (level) list = list.filter((item) => item.level === level);
  if (status) list = list.filter((item) => item.status === status);
  if (fileType) list = list.filter((item) => item.fileType === fileType || item.fileType === '全部');
  if (keyword) {
    list = list.filter((item) => item.code.toLowerCase().includes(keyword)
      || item.name.toLowerCase().includes(keyword)
      || item.pattern.toLowerCase().includes(keyword));
  }

  const usedFileTypes = Array.from(new Set(data.rules.map((item) => item.fileType)));
  return {
    rules: sortRules(list),
    levels: LEVELS.slice(),
    statuses: STATUSES.slice(),
    fileTypes: FILE_TYPES.slice(),
    usedFileTypes,
    // 分布始终按全量规则算，不受当前筛选影响，批量改级别前后的对比用同一个口径
    ruleCount: data.rules.length,
    distribution: distributionOf(data.rules),
  };
}

function getRule(id) {
  const data = load();
  const found = data.rules.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'RULE_NOT_FOUND', '这条规则不存在或已被删除', '');
  return found;
}

function createRule(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    code: validateCode(input.code, data, ''),
    name: validateName(input.name),
    level: validateLevel(input.level),
    status: validateStatus(input.status),
    fileType: validateFileType(input.fileType),
    pattern: validatePattern(input.pattern),
    note: validateNote(input.note),
    createdAt: now,
    updatedAt: now,
  };
  data.rules.push(created);
  save(data);
  return created;
}

function updateRule(id, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const found = data.rules.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'RULE_NOT_FOUND', '这条规则不存在或已被删除', '');

  found.code = input.code === undefined ? found.code : validateCode(input.code, data, found.id);
  found.name = input.name === undefined ? found.name : validateName(input.name);
  found.level = input.level === undefined ? found.level : validateLevel(input.level);
  found.status = input.status === undefined ? found.status : validateStatus(input.status);
  found.fileType = input.fileType === undefined ? found.fileType : validateFileType(input.fileType);
  found.pattern = input.pattern === undefined ? found.pattern : validatePattern(input.pattern);
  found.note = input.note === undefined ? found.note : validateNote(input.note);
  found.updatedAt = new Date().toISOString();
  save(data);
  return found;
}

function deleteRule(id) {
  const data = load();
  const index = data.rules.findIndex((item) => item.id === id);
  if (index === -1) throw new ApiError(404, 'RULE_NOT_FOUND', '这条规则不存在或已被删除', '');
  const [removed] = data.rules.splice(index, 1);
  save(data);
  return { id: removed.id, code: removed.code, name: removed.name };
}

// 全量规则按级别分布，三个级别始终都给出来
function distributionOf(rules) {
  const byLevel = {};
  LEVELS.forEach((item) => { byLevel[item] = 0; });
  rules.forEach((rule) => { byLevel[rule.level] += 1; });
  return byLevel;
}

// 命中的身份：规则、文件、行号与那一行内容。匹配写法不变时改级别不会让命中增减，
// 只会换级别，所以预演与执行后重扫的命中集合必然一致
function hitKey(hit) {
  return `${hit.ruleId}|${hit.fileId}|${hit.lineNo}|${hit.lineText}`;
}

function normalizeScope(scope) {
  const input = scope && typeof scope === 'object' ? scope : {};
  return {
    ruleId: pickText(input.ruleId),
    fileId: pickText(input.fileId),
    level: pickText(input.level),
  };
}

// 批量改级别的预演：只算不写。执行端直接复用这份结果，保证两边条数一处不差
function planBatchLevel(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const targetLevel = pickText(input.level);
  if (!targetLevel) {
    throw new ApiError(400, 'LEVEL_REQUIRED', '请选择要改成的级别', 'level');
  }
  if (!LEVELS.includes(targetLevel)) {
    throw new ApiError(400, 'LEVEL_INVALID', `级别只能是 ${LEVELS.join('、')} 其中之一`, 'level');
  }
  if (!Array.isArray(input.ruleIds)) {
    throw new ApiError(400, 'RULE_IDS_REQUIRED', '请先勾选要改级别的规则', 'ruleIds');
  }

  const rawIds = input.ruleIds.map((item) => pickText(item)).filter(Boolean);
  if (rawIds.length === 0) {
    throw new ApiError(400, 'RULE_IDS_REQUIRED', '请先勾选要改级别的规则', 'ruleIds');
  }
  // 勾选项去重，重复出现的次数要在预演里写明
  const ruleIds = [];
  let duplicated = 0;
  rawIds.forEach((id) => {
    if (ruleIds.includes(id)) { duplicated += 1; } else { ruleIds.push(id); }
  });

  const data = load();
  const missing = ruleIds.filter((id) => !data.rules.some((rule) => rule.id === id));
  if (missing.length > 0) {
    throw new ApiError(404, 'RULE_NOT_FOUND', `有 ${missing.length} 条规则已经不在清单里，请刷新后重新勾选`, 'ruleIds');
  }

  const selected = ruleIds
    .map((id) => data.rules.find((rule) => rule.id === id))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : (a.id < b.id ? -1 : 1)));

  const items = selected.map((rule) => ({
    ruleId: rule.id,
    code: rule.code,
    name: rule.name,
    fromLevel: rule.level,
    toLevel: targetLevel,
    status: rule.status,
    disabled: rule.status !== STATUSES[0],
    changed: rule.level !== targetLevel,
  }));
  const changedItems = items.filter((item) => item.changed);
  const changedIds = new Set(changedItems.map((item) => item.ruleId));

  // 改完之后的全量规则分布：只动勾选且级别确实变化的规则
  const projectedRules = data.rules.map((rule) => (
    changedIds.has(rule.id) ? { ...rule, level: targetLevel } : rule
  ));
  const ruleDistribution = {
    before: distributionOf(data.rules),
    after: distributionOf(projectedRules),
  };

  // 上一轮命中影响：按页面给回的扫描范围，用现行规则与改后规则各算一遍
  const scope = normalizeScope(input.scope);
  let hits = null;
  if (input.scope !== undefined) {
    const beforeScan = scanCore({ data, ...scope });
    const afterScan = scanCore({ data: { ...data, rules: projectedRules }, ...scope });
    const beforeKeys = new Set(beforeScan.hits.map(hitKey));
    const afterKeys = new Set(afterScan.hits.map(hitKey));
    const enabledChangedIds = new Set(changedItems
      .filter((item) => !item.disabled)
      .map((item) => item.ruleId));
    hits = {
      scope,
      before: { total: beforeScan.summary.total, byLevel: beforeScan.summary.byLevel },
      after: { total: afterScan.summary.total, byLevel: afterScan.summary.byLevel },
      // 现行结果里、级别会被换掉的命中条数（停用规则不参与比对，不计在内）
      affectedCount: beforeScan.hits.filter((hit) => enabledChangedIds.has(hit.ruleId)).length,
      // 范围按级别过滤时，改级别会让一部分命中离开当前范围、另一部分进入
      leftFilterCount: beforeScan.hits.filter((hit) => !afterKeys.has(hitKey(hit))).length,
      joinedFilterCount: afterScan.hits.filter((hit) => !beforeKeys.has(hitKey(hit))).length,
    };
  }

  // 级别变化后需要重新确认的忽略：忽略时记下的级别与目标级别对不上
  const reconfirms = data.ignores
    .filter((ignore) => changedIds.has(ignore.ruleId) && ignore.level !== targetLevel)
    .map((ignore) => {
      const rule = data.rules.find((item) => item.id === ignore.ruleId);
      const file = data.files.find((item) => item.id === ignore.fileId);
      return {
        id: ignore.id,
        ruleId: ignore.ruleId,
        code: rule ? rule.code : '',
        path: file ? file.path : '',
        lineNo: ignore.lineNo,
        lineText: ignore.lineText,
        fromLevel: ignore.level,
        toLevel: targetLevel,
      };
    })
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : (a.path < b.path ? -1 : 1)));

  return {
    targetLevel,
    scope,
    total: items.length,
    changedCount: changedItems.length,
    unchangedCount: items.length - changedItems.length,
    disabledCount: items.filter((item) => item.disabled).length,
    enabledCount: items.filter((item) => !item.disabled).length,
    duplicated,
    items,
    ruleDistribution,
    hits,
    reconfirms,
  };
}

// 执行批量改级别：先把全部校验做完，再一次性改完落盘，中间不会留下半截结果
function applyBatchLevel(payload) {
  const plan = planBatchLevel(payload);
  const data = load();
  const changedIds = new Set(plan.items.filter((item) => item.changed).map((item) => item.ruleId));
  const now = new Date().toISOString();
  data.rules.forEach((rule) => {
    if (changedIds.has(rule.id)) {
      rule.level = plan.targetLevel;
      rule.updatedAt = now;
    }
  });
  save(data);
  return plan;
}

module.exports = {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  planBatchLevel,
  applyBatchLevel,
};
