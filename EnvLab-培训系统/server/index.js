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
const SECRET = process.env.ENVLAB_SECRET || 'envlab-dev-secret-change-me';
const PORT = parseInt(process.env.PORT || '8899', 10);

// 管理员账号（培训记录台专用）：姓名 ENVLAB / 工号 001
const ADMIN = { name: 'ENVLAB', emp: '001', lab: '001', phone: '001' };

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

function newToken(emp, role) {
  const t = crypto.randomBytes(24).toString('hex');
  db.tokens[t] = { emp, role, ts: Date.now() };
  saveDB(db);
  return t;
}
function auth(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/);
  if (!m) return null;
  return db.tokens[m[1]] || null;
}

// ---------------- 工具 ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8'
};
function sendJSON(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { resolve({}); } });
  });
}
function checkAdmin(p) {
  return (p && p.name && p.name.toUpperCase() === ADMIN.name && p.emp === ADMIN.emp);
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
    const name = (b.name || '').trim(), emp = (b.emp || '').trim(),
          lab = (b.lab || '').trim(), phone = (b.phone || '').trim();
    if (!name || !emp || !lab) { sendJSON(res, 400, { error: '姓名、工号、机构为必填项' }); return; }
    db.trainees[emp] = { name, emp, lab, phone, role: 'trainee', updatedAt: Date.now() };
    saveDB(db);
    const token = newToken(emp, 'trainee');
    sendJSON(res, 200, { token, profile: db.trainees[emp] });
    return;
  }

  // 学员登录（按工号）
  if (pathname === '/api/trainee/login' && req.method === 'POST') {
    const b = await readBody(req);
    const emp = (b.emp || '').trim();
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

  // 保存培训记录（云端）
  if (pathname === '/api/training' && req.method === 'POST') {
    const a = auth(req);
    if (!a) { sendJSON(res, 401, { error: '未登录' }); return; }
    const b = await readBody(req);
    const rec = {
      id: 'TR' + crypto.randomBytes(5).toString('hex'),
      ts: new Date().toISOString(),
      emp: a.emp,
      trainee: (b.trainee || db.trainees[a.emp]?.name || a.emp),
      lab: (b.lab || db.trainees[a.emp]?.lab || ''),
      instrumentId: b.instrumentId || '',
      instrumentName: b.instrumentName || '',
      model: b.model || '',
      durationSec: b.durationSec || 0,
      score: b.score || 0,
      fatalHits: b.fatalHits || 0,
      passed: !!b.passed,
      steps: b.steps || []
    };
    db.trainings.push(rec);
    saveDB(db);
    sendJSON(res, 200, { id: rec.id });
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
    if (!checkAdmin(b)) { sendJSON(res, 401, { error: '管理员账号为 姓名 ENVLAB / 工号 001' }); return; }
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
    handleApi(req, res, pathname).catch(e => sendJSON(res, 500, { error: '服务器错误: ' + e.message }));
  } else {
    serveStatic(req, res, pathname);
  }
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('EnvLab 培训系统后端已启动: http://localhost:' + PORT);
  console.log('前端入口: http://localhost:' + PORT + '/  记录台: /admin.html');
});
