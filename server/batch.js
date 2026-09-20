// 批量改级别：预演与执行共用同一份规划函数，两边看到的数字必然一致
const { load, save, LEVELS, STATUSES, summarizeHits } = require('./store');
const { ApiError } = require('./errors');

function countRulesByLevel(rules) {
  const counts = {};
  LEVELS.forEach((item) => { counts[item] = 0; });
  rules.forEach((item) => { counts[item.level] = (counts[item.level] || 0) + 1; });
  return counts;
}

function countHitsByLevel(hits) {
  const counts = {};
  LEVELS.forEach((item) => { counts[item] = 0; });
  hits.forEach((hit) => { counts[hit.level] = (counts[hit.level] || 0) + 1; });
  return counts;
}

// 读批量请求：规则编号去重后不能为空，目标级别必须是认得的几种
function readBatchInput(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const rawIds = Array.isArray(input.ruleIds) ? input.ruleIds : [];
  const ruleIds = Array.from(new Set(
    rawIds.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean),
  ));
  if (!ruleIds.length) throw new ApiError(400, 'BATCH_EMPTY', '先勾选要改级别的规则', 'batchLevel');
  const level = typeof input.level === 'string' ? input.level.trim() : '';
  if (!LEVELS.includes(level)) {
    throw new ApiError(400, 'LEVEL_INVALID', `级别只能是 ${LEVELS.join('、')} 其中之一`, 'batchLevel');
  }
  return { ruleIds, level };
}

// 规划这一批怎么改：哪些真改、哪些跳过（逐条写明原因）、改完后的分布、对上一轮结果的连带影响
function planBatchLevelChange(data, ruleIds, targetLevel) {
  const changes = [];
  const skipped = [];
  const skippedBreakdown = { disabled: 0, sameLevel: 0, missing: 0 };
  let enabledCount = 0;
  let disabledCount = 0;

  ruleIds.forEach((id) => {
    const rule = data.rules.find((item) => item.id === id);
    if (!rule) {
      skipped.push({ id, code: '', name: '', from: '', reason: '规则不存在或已被删除' });
      skippedBreakdown.missing += 1;
      return;
    }
    if (rule.status === STATUSES[0]) enabledCount += 1;
    else disabledCount += 1;
    if (rule.status !== STATUSES[0]) {
      skipped.push({ id: rule.id, code: rule.code, name: rule.name, from: rule.level, reason: `当前是${rule.status}状态，不改动` });
      skippedBreakdown.disabled += 1;
      return;
    }
    if (rule.level === targetLevel) {
      skipped.push({ id: rule.id, code: rule.code, name: rule.name, from: rule.level, reason: `已经是${targetLevel}，不需要改` });
      skippedBreakdown.sameLevel += 1;
      return;
    }
    changes.push({ id: rule.id, code: rule.code, name: rule.name, from: rule.level, to: targetLevel });
  });

  // 全部规则按级别的分布：在现在的基础上把要改的逐条搬过去
  const rulesBefore = countRulesByLevel(data.rules);
  const rulesAfter = { ...rulesBefore };
  changes.forEach((change) => {
    rulesAfter[change.from] -= 1;
    rulesAfter[change.to] += 1;
  });

  // 连带影响：上一轮结果里这些规则的命中跟着换级别，其中已忽略的要重新确认
  const changedIds = new Set(changes.map((change) => change.id));
  let lastScan = null;
  if (data.lastScan && Array.isArray(data.lastScan.hits)) {
    const byLevelBefore = countHitsByLevel(data.lastScan.hits);
    const byLevelAfter = { ...byLevelBefore };
    const recheck = [];
    let hitsToRelevel = 0;
    data.lastScan.hits.forEach((hit) => {
      if (!changedIds.has(hit.ruleId)) return;
      hitsToRelevel += 1;
      byLevelAfter[hit.level] -= 1;
      byLevelAfter[targetLevel] += 1;
      if (hit.state === '已忽略') {
        recheck.push({ hitId: hit.id, code: hit.code, path: hit.path, lineNo: hit.lineNo, lineText: hit.lineText });
      }
    });
    lastScan = {
      scannedAt: data.lastScan.scannedAt,
      hitsToRelevel,
      byLevelBefore,
      byLevelAfter,
      recheck,
    };
  }

  return {
    targetLevel,
    total: ruleIds.length,
    changes,
    skipped,
    skippedBreakdown,
    enabledCount,
    disabledCount,
    rulesByLevel: { before: rulesBefore, after: rulesAfter },
    lastScan,
  };
}

// 预演：只算不落盘
function previewBatchLevel(payload) {
  const { ruleIds, level } = readBatchInput(payload);
  return planBatchLevelChange(load(), ruleIds, level);
}

// 执行：在最新数据上重新规划（不信预演那一刻的快照），改规则、改上一轮命中，一次落盘
function applyBatchLevel(payload) {
  const { ruleIds, level } = readBatchInput(payload);
  const data = load();
  const plan = planBatchLevelChange(data, ruleIds, level);
  if (!plan.changes.length) return plan;

  const now = new Date().toISOString();
  const changedIds = new Set(plan.changes.map((change) => change.id));
  data.rules.forEach((rule) => {
    if (changedIds.has(rule.id)) {
      rule.level = level;
      rule.updatedAt = now;
    }
  });
  if (data.lastScan && Array.isArray(data.lastScan.hits)) {
    data.lastScan.hits.forEach((hit) => {
      if (!changedIds.has(hit.ruleId)) return;
      hit.level = level;
      if (hit.state === '已忽略') hit.state = '待重新确认';
    });
    data.lastScan.summary = summarizeHits(data.lastScan.hits);
  }
  save(data);
  return plan;
}

module.exports = { previewBatchLevel, applyBatchLevel, planBatchLevelChange };
