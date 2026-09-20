const crypto = require('crypto');
const { load, save, LEVELS, STATUSES, HIT_STATES, summarizeHits } = require('./store');
const { ApiError, pickText } = require('./errors');

// 一条规则管不管这个文件：适用文件类型写成全部的管所有文件，否则只认同类型的
function ruleAppliesToFile(rule, file) {
  return rule.fileType === '全部' || rule.fileType === file.type;
}

function levelOrder(level) {
  const index = LEVELS.indexOf(level);
  return index === -1 ? LEVELS.length : index;
}

// 同一条命中在上一轮里的定位方式：同规则、同文件、同行就算同一条
function hitKey(ruleId, fileId, lineNo) {
  return `${ruleId} ${fileId} ${lineNo}`;
}

// 规则或文件删掉之后，上一轮结果里对应的命中也一并清掉，汇总跟着重算
function pruneScanHits(data, keep) {
  if (!data.lastScan || !Array.isArray(data.lastScan.hits)) return;
  data.lastScan.hits = data.lastScan.hits.filter(keep);
  data.lastScan.summary = summarizeHits(data.lastScan.hits);
}

// 扫一遍：启用的规则逐条去比对范围内的文件，命中记到具体行上；
// 结果存成上一轮扫描，之前标过的忽略状态按位置继承下来
function scan(options) {
  const input = options && typeof options === 'object' ? options : {};
  const level = pickText(input.level);
  const fileId = pickText(input.fileId);
  const ruleId = pickText(input.ruleId);

  if (level && !LEVELS.includes(level)) {
    throw new ApiError(400, 'LEVEL_INVALID', `级别只能是 ${LEVELS.join('、')} 其中之一`, 'scanLevel');
  }

  const data = load();

  let scopeFile = null;
  if (fileId) {
    scopeFile = data.files.find((item) => item.id === fileId);
    if (!scopeFile) throw new ApiError(404, 'FILE_NOT_FOUND', '选中的文件不在清单里', 'scanFile');
  }

  let scopeRule = null;
  if (ruleId) {
    scopeRule = data.rules.find((item) => item.id === ruleId);
    if (!scopeRule) throw new ApiError(404, 'RULE_NOT_FOUND', '选中的规则不在清单里', 'scanRule');
  }

  const enabled = data.rules.filter((item) => item.status === STATUSES[0]);
  const warning = scopeRule && scopeRule.status !== STATUSES[0]
    ? `${scopeRule.code} 当前是停用状态，这一轮不参与比对`
    : '';

  const rulesUsed = enabled
    .filter((item) => !scopeRule || item.id === scopeRule.id)
    .filter((item) => !level || item.level === level);

  const filesInScope = scopeFile ? [scopeFile] : data.files;

  const previousHits = data.lastScan && Array.isArray(data.lastScan.hits) ? data.lastScan.hits : [];
  const previousByKey = new Map(previousHits.map((hit) => [hitKey(hit.ruleId, hit.fileId, hit.lineNo), hit]));

  const hits = [];
  rulesUsed.forEach((rule) => {
    filesInScope.filter((file) => ruleAppliesToFile(rule, file)).forEach((file) => {
      file.content.split('\n').forEach((text, index) => {
        if (text.includes(rule.pattern)) {
          const before = previousByKey.get(hitKey(rule.id, file.id, index + 1));
          hits.push({
            id: before ? before.id : crypto.randomUUID(),
            ruleId: rule.id,
            code: rule.code,
            ruleName: rule.name,
            level: rule.level,
            pattern: rule.pattern,
            fileId: file.id,
            path: file.path,
            fileType: file.type,
            lineNo: index + 1,
            lineText: text.trim(),
            state: before ? before.state : HIT_STATES[0],
          });
        }
      });
    });
  });

  hits.sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.lineNo - b.lineNo;
  });

  const result = {
    scannedAt: new Date().toISOString(),
    enabledRules: enabled.length,
    rulesUsed: rulesUsed.length,
    filesInScope: filesInScope.length,
    filesTotal: data.files.length,
    rulesTotal: data.rules.length,
    warning,
    hits,
    summary: summarizeHits(hits),
  };

  data.lastScan = result;
  save(data);
  return result;
}

// 上一轮扫描结果，还没扫过就是 null
function getLastScan() {
  return load().lastScan;
}

// 改某条命中的处置状态（正常、已忽略、待重新确认），返回改完后的整份上一轮结果
function setHitState(hitId, value) {
  const state = pickText(value);
  if (!HIT_STATES.includes(state)) {
    throw new ApiError(400, 'HIT_STATE_INVALID', `处置状态只能是 ${HIT_STATES.join('、')} 其中之一`, 'hitState');
  }
  const data = load();
  const lastScan = data.lastScan;
  const hit = lastScan && lastScan.hits.find((item) => item.id === hitId);
  if (!hit) throw new ApiError(404, 'HIT_NOT_FOUND', '这条命中不在上一轮结果里', '');
  hit.state = state;
  lastScan.summary = summarizeHits(lastScan.hits);
  save(data);
  return lastScan;
}

module.exports = { scan, getLastScan, setHitState, pruneScanHits, ruleAppliesToFile, levelOrder };
