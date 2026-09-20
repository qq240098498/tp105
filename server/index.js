const path = require('path');
const express = require('express');
const api = require('./api');

const app = express();
const PORT = process.env.PORT || 5105;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// 健康检查：页面右上角据此显示服务连接状态
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, port: PORT });
});

app.get('/api/rules', (req, res) => {
  res.json(api.listRules({
    level: api.readQuery(req.query, 'level'),
    status: api.readQuery(req.query, 'status'),
    fileType: api.readQuery(req.query, 'fileType'),
    keyword: api.readQuery(req.query, 'keyword'),
  }));
});

app.post('/api/rules', (req, res) => {
  try {
    res.status(201).json(api.createRule(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

// 批量改级别：先预演再执行，两个接口共用同一份规划，数字必然对得上
app.post('/api/rules/batch-level/preview', (req, res) => {
  try {
    res.json(api.previewBatchLevel(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/rules/batch-level', (req, res) => {
  try {
    res.json(api.applyBatchLevel(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/rules/:id', (req, res) => {
  try {
    res.json(api.getRule(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/rules/:id', (req, res) => {
  try {
    res.json(api.updateRule(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/rules/:id', (req, res) => {
  try {
    res.json(api.deleteRule(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/files', (req, res) => {
  res.json(api.listFiles({
    type: api.readQuery(req.query, 'type'),
    keyword: api.readQuery(req.query, 'keyword'),
  }));
});

app.post('/api/files', (req, res) => {
  try {
    res.status(201).json(api.createFile(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/files/:id', (req, res) => {
  try {
    res.json(api.getFile(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/files/:id', (req, res) => {
  try {
    res.json(api.updateFile(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/files/:id', (req, res) => {
  try {
    res.json(api.deleteFile(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// 扫一遍：可以只扫某一条规则、某一个文件，也可以只留某个级别
app.post('/api/scan', (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    res.json(api.scan({
      level: body.level,
      fileId: body.fileId,
      ruleId: body.ruleId,
    }));
  } catch (err) {
    sendError(res, err);
  }
});

// 上一轮扫描结果：页面打开时先拉这个，还没扫过就是 null
app.get('/api/scan/last', (_req, res) => {
  res.json({ scan: api.getLastScan() });
});

// 改某条命中的处置状态：正常、已忽略、待重新确认
app.patch('/api/scan/last/hits/:id', (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    res.json(api.setHitState(req.params.id, body.state));
  } catch (err) {
    sendError(res, err);
  }
});

// 未匹配到的接口路径统一返回说明，避免前端拿到一串页面内容
app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'API_NOT_FOUND', message: '接口不存在', field: '' } });
});

// 统一错误出口：业务异常按状态码与错误码返回，其余按服务异常处理
function sendError(res, err) {
  if (err instanceof api.ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, field: err.field },
    });
  }
  console.error('[tp105] 处理请求时出现未预期的问题：', err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: '服务内部异常，请稍后重试', field: '' },
  });
}

// 请求体解析失败时给出明确说明
app.use((err, _req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'BODY_INVALID_JSON', message: '提交的内容不是合法的 JSON', field: '' },
    });
  }
  if (err) return sendError(res, err);
  return next();
});

app.listen(PORT, () => {
  console.log(`检查规则与命中清单工作台已启动：http://localhost:${PORT}`);
});
