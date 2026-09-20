const crypto = require('crypto');
const { load, save } = require('./store');
const { ApiError, pickText } = require('./errors');
const { ruleAppliesToFile } = require('./scan');

// 把规则与文件的现行信息带到忽略记录上，页面才能写出是哪条命中
function withRefs(ignore, data) {
  const rule = data.rules.find((item) => item.id === ignore.ruleId);
  const file = data.files.find((item) => item.id === ignore.fileId);
  return {
    ...ignore,
    code: rule ? rule.code : '',
    ruleName: rule ? rule.name : '',
    currentLevel: rule ? rule.level : '',
    path: file ? file.path : '',
    needsReconfirm: rule ? ignore.level !== rule.level : false,
  };
}

function listIgnores() {
  const data = load();
  return { ignores: data.ignores.map((item) => withRefs(item, data)) };
}

// 忽略一条命中：页面给出规则、文件与行号，服务端按现行规则复核这一行确实命中，
// 顺手把行内容与当时的级别快照下来，作为以后要不要重新确认的依据
function ignoreHit(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const ruleId = pickText(input.ruleId);
  const fileId = pickText(input.fileId);
  const lineNo = Number(input.lineNo);

  if (!ruleId) throw new ApiError(400, 'RULE_ID_REQUIRED', '请指明要忽略哪条规则的命中', 'ruleId');
  if (!fileId) throw new ApiError(400, 'FILE_ID_REQUIRED', '请指明命中的文件', 'fileId');
  if (!Number.isInteger(lineNo) || lineNo < 1) {
    throw new ApiError(400, 'LINE_NO_INVALID', '行号需要是正整数', 'lineNo');
  }

  const data = load();
  const rule = data.rules.find((item) => item.id === ruleId);
  if (!rule) throw new ApiError(404, 'RULE_NOT_FOUND', '这条规则不存在或已被删除', 'ruleId');
  const file = data.files.find((item) => item.id === fileId);
  if (!file) throw new ApiError(404, 'FILE_NOT_FOUND', '这个文件不存在或已被移出清单', 'fileId');
  if (!ruleAppliesToFile(rule, file)) {
    throw new ApiError(400, 'HIT_NOT_FOUND', '这条规则不管这个类型的文件，没有这条命中', 'lineNo');
  }

  const lines = file.content.split('\n');
  const lineText = (lines[lineNo - 1] || '').trim();
  if (!lineText || !lineText.includes(rule.pattern)) {
    throw new ApiError(400, 'HIT_NOT_FOUND', '这一行当前并没有命中该规则，没法忽略', 'lineNo');
  }

  const duplicated = data.ignores.find((item) => item.ruleId === ruleId
    && item.fileId === fileId
    && item.lineNo === lineNo
    && item.lineText === lineText);
  if (duplicated) {
    throw new ApiError(409, 'IGNORE_DUPLICATED', '这条命中已经在忽略清单里了', '');
  }

  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    ruleId,
    fileId,
    lineNo,
    lineText,
    level: rule.level,
    createdAt: now,
    updatedAt: now,
  };
  data.ignores.push(created);
  save(data);
  return withRefs(created, data);
}

// 规则改了级别之后，把一条忽略按新的级别重新确认下来
function reconfirmIgnore(id) {
  const data = load();
  const found = data.ignores.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'IGNORE_NOT_FOUND', '这条忽略记录不存在', '');
  const rule = data.rules.find((item) => item.id === found.ruleId);
  if (!rule) throw new ApiError(404, 'RULE_NOT_FOUND', '对应的规则已被删除，没法重新确认', '');
  found.level = rule.level;
  found.updatedAt = new Date().toISOString();
  save(data);
  return withRefs(found, data);
}

function cancelIgnore(id) {
  const data = load();
  const index = data.ignores.findIndex((item) => item.id === id);
  if (index === -1) throw new ApiError(404, 'IGNORE_NOT_FOUND', '这条忽略记录不存在', '');
  const [removed] = data.ignores.splice(index, 1);
  save(data);
  return { id: removed.id, ruleId: removed.ruleId, fileId: removed.fileId, lineNo: removed.lineNo };
}

module.exports = {
  listIgnores,
  ignoreHit,
  reconfirmIgnore,
  cancelIgnore,
  withRefs,
};
