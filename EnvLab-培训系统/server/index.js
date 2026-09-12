/**
 * EnvLab 培训系统 · 后端服务（零外部依赖，仅用 Node 内置模块）
 * - 学员真实账号（注册/登录，持久化于云端 db.json）
 * - 培训记录云端存储、多端共享
 * - 同源托管前端静态文件，并注入 API_BASE 使前端自动走云端
 * 运行：node server/index.js   （可选 PORT=3000 环境变量）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');            // EnvLab-培训系统
const DB_PATH = path.join(__dirname, 'db.json');
const IS_PROD = process.env.NODE_ENV === 'production';
const SECRET = process.env.ENVLAB_SECRET || '';
const CORS_ORIGIN = process.env.ENVLAB_CORS_ORIGIN || '';
const PORT = parseInt(process.env.PORT || '8899', 10);
const HOST = process.env.ENVLAB_HOST || '127.0.0.1';
const TOKEN_TTL_MS = Math.max(15 * 60 * 1000, parseInt(process.env.ENVLAB_TOKEN_TTL_MS || String(8 * 60 * 60 * 1000), 10));
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT = 160;

// 管理员账号：生产环境必须通过环境变量提供，开发环境保留演示值但明确警告
const ADMIN = {
  name: (process.env.ENVLAB_ADMIN_NAME || 'ENVLAB').trim(),
  emp: (process.env.ENVLAB_ADMIN_EMP || '001').trim(),
  lab: (process.env.ENVLAB_ADMIN_LAB || '001').trim(),
  phone: (process.env.ENVLAB_ADMIN_PHONE || '001').trim()
};
if (IS_PROD && (!SECRET || !process.env.ENVLAB_ADMIN_NAME || !process.env.ENVLAB_ADMIN_EMP)) {
  throw new Error('生产环境必须设置 ENVLAB_SECRET、ENVLAB_ADMIN_NAME、ENVLAB_ADMIN_EMP');
}
if (!IS_PROD && (!SECRET || ADMIN.name === 'ENVLAB' || ADMIN.emp === '001')) {
  console.warn('警告：当前使用开发环境默认后端凭据；部署到公网前请设置 ENVLAB_SECRET / ENVLAB_ADMIN_*。');
}

// ---------------- 数据库（JSON 文件，原子写） ----------------
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch (e) { return { trainees: {}, tokens: {}, trainings: [] }; }
}
function saveDB(db) {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}
let db = loadDB();

function tokenKey(token) {
  return crypto.createHmac('sha256', SECRET || 'development-only-secret').update(token).digest('hex');
}
function newToken(emp, role) {
  const t = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  db.tokens[tokenKey(t)] = { emp, role, ts: now, expiresAt: now + TOKEN_TTL_MS };
  saveDB(db);
  return t;
}
function auth(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+([A-Fa-f0-9]{32,128})$/);
  if (!m) return null;
  const key = tokenKey(m[1]);
  const record = db.tokens[key];
  if (!record) return null;
  if (!record.expiresAt || record.expiresAt <= Date.now()) {
    delete db.tokens[key];
    saveDB(db);
    return null;
  }
  return record;
}

// ---------------- 工具 ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8'
};
function sendJSON(res, code, obj) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store'
  };
  // 不再使用 *：跨域部署时必须明确配置允许的前端来源。
  if (CORS_ORIGIN) {
    headers['Access-Control-Allow-Origin'] = CORS_ORIGIN;
    headers.Vary = 'Origin';
  }
  res.writeHead(code, headers);
  res.end(JSON.stringify(obj));
}
function bodyError(message, statusCode) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    let size = 0;
    let settled = false;
    req.on('data', c => {
      if (settled) return;
      size += Buffer.byteLength(c);
      if (size > MAX_BODY_BYTES) {
        settled = true;
        reject(bodyError('请求体过大（上限 64 KB）', 413));
        req.destroy();
        return;
      }
      d += c;
    });
    req.on('end', () => {
      if (settled) return;
      if (!d.trim()) { resolve({}); return; }
      try {
        const value = JSON.parse(d);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          reject(bodyError('请求体必须是 JSON 对象', 400));
        } else resolve(value);
      } catch (e) {
        reject(bodyError('JSON 格式错误', 400));
      }
    });
    req.on('error', e => { if (!settled) reject(e); });
  });
}
function text(v, max = MAX_TEXT) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function finiteNumber(v, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function checkAdmin(p) {
  return text(p && p.name).toUpperCase() === ADMIN.name.toUpperCase() && text(p && p.emp, 80) === ADMIN.emp;
}
function loadInstrumentConfig(id) {
  const safe = text(id, 80).toLowerCase();
  if (!safe || !/^[a-z0-9-]+$/.test(safe)) return null;
  const fp = path.join(ROOT, 'instruments', safe + '.json');
  if (!fp.startsWith(path.join(ROOT, 'instruments') + path.sep) || !fs.existsSync(fp)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return cfg && Array.isArray(cfg.steps) ? cfg : null;
  } catch (e) { return null; }
}
function assessTraining(payload) {
  const rawSteps = Array.isArray(payload.steps) ? payload.steps.slice(0, 100) : [];
  const cfg = loadInstrumentConfig(payload.instrumentId);
  const hasAttempts = rawSteps.length > 0 && rawSteps.every(s => s && Array.isArray(s.attempts));
  if (cfg && rawSteps.length !== cfg.steps.length) {
    throw bodyError('培训步骤数量与当前仪器配置不一致', 400);
  }
  const steps = rawSteps.map((s, i) => {
    const expected = cfg && cfg.steps[i];
    if (expected && Array.isArray(s.attempts)) {
      let fatal = false, solved = false, wrong = false;
      const attempts = s.attempts.slice(0, 50).map(a => {
        const index = Number(a && a.index);
        if (!Number.isInteger(index) || index < 0 || index >= expected.options.length) {
          throw bodyError('培训答案索引无效', 400);
        }
        const option = expected.options[index];
        if (option.fatal) fatal = true;
        else if (option.correct) solved = true;
        else wrong = true;
        return { index };
      });
      return {
        q: text(expected.q),
        correct: solved && !fatal,
        partial: solved && wrong && !fatal,
        fatal,
        attempts
      };
    }
    // 兼容尚未带 attempts 的旧版客户端，但标记为未完成服务端独立核验。
    return {
      q: text(s && s.q),
      correct: !!(s && s.correct),
      partial: !!(s && s.partial) && !(s && s.correct),
      fatal: !!(s && s.fatal),
      attempts: []
    };
  });
  const fatalHits = steps.filter(s => s.fatal).length;
  const credits = steps.map(s => s.fatal ? 0 : s.correct ? 1 : s.partial ? 0.5 : 0);
  const score = steps.length ? Math.round(credits.reduce((a, b) => a + b, 0) / steps.length * 100) : 0;
  const threshold = cfg ? finiteNumber(cfg.passThreshold, 80, 0, 100) : 80;
  return {
    steps, score, fatalHits,
    passed: fatalHits === 0 && score >= threshold,
    serverVerified: !!cfg && hasAttempts
  };
}

// ---------------- API 路由 ----------------
async function handleApi(req, res, pathname) {
  // 预检
  if (req.method === 'OPTIONS') { sendJSON(res, 204, {}); return; }

  // 健康
  if (pathname === '/api/health') { sendJSON(res, 200, { ok: true, time: Date.now() }); return; }

  // 学员注册（真实账号，云端持久化）
  if (pathname === '/api/trainee/register' && req.method === 'POST') {
    const b = await readBody(req);
    const name = text(b.name), emp = text(b.emp, 80),
          lab = text(b.lab), phone = text(b.phone, 40);
    if (!name || !emp || !lab) { sendJSON(res, 400, { error: '姓名、工号、机构为必填项' }); return; }
    if (name.length < 2 || emp.length < 1) { sendJSON(res, 400, { error: '姓名或工号格式不正确' }); return; }
    db.trainees[emp] = { name, emp, lab, phone, role: 'trainee', updatedAt: Date.now() };
    saveDB(db);
    const token = newToken(emp, 'trainee');
    sendJSON(res, 200, { token, profile: db.trainees[emp] });
    return;
  }

  // 学员登录（按工号）
  if (pathname === '/api/trainee/login' && req.method === 'POST') {
    const b = await readBody(req);
    const emp = text(b.emp, 80);
    const t = db.trainees[emp];
    if (!t) { sendJSON(res, 401, { error: '该工号尚未登记，请先注册' }); return; }
    const token = newToken(emp, 'trainee');
    sendJSON(res, 200, { token, profile: t });
    return;
  }

  // 当前学员信息
  if (pathname === '/api/trainee/me' && req.method === 'GET') {
    const a = auth(req);
    if (!a || a.role !== 'trainee') { sendJSON(res, 401, { error: '未登录' }); return; }
    sendJSON(res, 200, db.trainees[a.emp] || { emp: a.emp });
    return;
  }

  // 保存培训记录（云端）：服务端重算结果，不信任客户端 score/passed/fatalHits
  if (pathname === '/api/training' && req.method === 'POST') {
    const a = auth(req);
    if (!a || a.role !== 'trainee') { sendJSON(res, 401, { error: '未登录' }); return; }
    const b = await readBody(req);
    const profile = db.trainees[a.emp] || {};
    const clientId = text(req.headers['x-idempotency-key'] || b.id, 100);
    if (clientId) {
      const existing = db.trainings.find(r => r.emp === a.emp && r.clientId === clientId);
      if (existing) { sendJSON(res, 200, { id: existing.id, duplicate: true, serverVerified: !!existing.serverVerified }); return; }
    }
    const assessed = assessTraining(b);
    const cfg = loadInstrumentConfig(b.instrumentId);
    const rec = {
      id: 'TR' + crypto.randomBytes(5).toString('hex'),
      clientId,
      ts: new Date().toISOString(),
      emp: a.emp,
      trainee: text(profile.name || a.emp),
      lab: text(profile.lab),
      instrumentId: text(b.instrumentId, 80),
      instrumentName: text((cfg && cfg.name) || b.instrumentName),
      model: text((cfg && cfg.model) || b.model),
      durationSec: finiteNumber(b.durationSec, 0, 0, 86400),
      score: assessed.score,
      fatalHits: assessed.fatalHits,
      passed: assessed.passed,
      serverVerified: assessed.serverVerified,
      clientScore: finiteNumber(b.score, 0, 0, 100),
      clientPassed: !!b.passed,
      steps: assessed.steps
    };
    db.trainings.push(rec);
    saveDB(db);
    sendJSON(res, 200, { id: rec.id, serverVerified: rec.serverVerified, score: rec.score, passed: rec.passed });
    return;
  }

  // 我的培训记录
  if (pathname === '/api/training/mine' && req.method === 'GET') {
    const a = auth(req);
    if (!a) { sendJSON(res, 401, { error: '未登录' }); return; }
    const list = db.trainings.filter(r => r.emp === a.emp).reverse();
    sendJSON(res, 200, list);
    return;
  }

  // 管理员登录
  if (pathname === '/api/admin/login' && req.method === 'POST') {
    const b = await readBody(req);
    if (!checkAdmin(b)) { sendJSON(res, 401, { error: '管理员账号或凭据错误' }); return; }
    const token = newToken('001', 'admin');
    sendJSON(res, 200, {
      token,
      profile: { name: ADMIN.name, emp: ADMIN.emp, lab: b.lab || ADMIN.lab, phone: b.phone || ADMIN.phone, role: 'admin' }
    });
    return;
  }

  // 管理员：全部培训记录（多端共享）
  if (pathname === '/api/admin/records' && req.method === 'GET') {
    const a = auth(req);
    if (!a || a.role !== 'admin') { sendJSON(res, 401, { error: '需要管理员权限' }); return; }
    sendJSON(res, 200, db.trainings.slice().reverse());
    return;
  }

  // 管理员：全部学员
  if (pathname === '/api/admin/trainees' && req.method === 'GET') {
    const a = auth(req);
    if (!a || a.role !== 'admin') { sendJSON(res, 401, { error: '需要管理员权限' }); return; }
    sendJSON(res, 200, Object.values(db.trainees));
    return;
  }

  sendJSON(res, 404, { error: 'API 不存在: ' + pathname });
}

// ---------------- 静态托管（注入 API_BASE） ----------------
function serveStatic(req, res, pathname) {
  let fp = decodeURIComponent(pathname);
  if (fp === '/' || fp === '') fp = '/index.html';
  // 禁止访问后端目录与数据库
  if (fp.startsWith('/server/') || fp === '/db.json' || fp === '/db.json.tmp') {
    res.writeHead(403); res.end('forbidden'); return;
  }
  const full = path.join(ROOT, fp);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  const ext = path.extname(full);
  let data = fs.readFileSync(full);
  if (ext === '.html') {
    // 注入 API_BASE，使前端自动走云端（无后端时占位符被忽略，前端回退本地）
    const inj = '<script>window.API_BASE="/api";</script>';
    data = Buffer.from(data.toString('utf8').replace('<!--API_BASE-->', inj));
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}

// ---------------- 入口 ----------------
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pathname = u.pathname;
  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch(e => {
      const status = Number.isInteger(e.statusCode) ? e.statusCode : 500;
      const message = status < 500 ? e.message : '服务器内部错误';
      sendJSON(res, status, { error: message });
    });
  } else {
    serveStatic(req, res, pathname);
  }
});
server.listen(PORT, HOST, () => {
  console.log('EnvLab 培训系统后端已启动: http://' + HOST + ':' + PORT);
  console.log('前端入口: http://localhost:' + PORT + '/  记录台: /admin.html');
});
