/**
 * EnvLab 培训系统 · 前端云端接入层
 * 设计：优先走后端(真实账号 + 云端共享)，网络不可达时自动回退本机(localStorage)。
 * 通过 ?api=URL 或后端注入的 window.API_BASE 决定云端基地址。
 */
(function () {
  const params = new URLSearchParams(location.search);
  const API_BASE = (params.get('api') || window.API_BASE || '').trim();
  const TOKEN_KEY = 'envlab_token';

  function token() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }

  const REQUEST_TIMEOUT_MS = 12000;
  const MAX_RETRIES = 2;
  const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function req(path, opts) {
    if (!API_BASE) throw new Error('no-cloud');
    const original = Object.assign({}, opts || {});
    const retry = original.retry === true || ['GET', 'HEAD'].includes((original.method || 'GET').toUpperCase());
    delete original.retry;
    const headers = Object.assign({}, original.headers);
    const tk = token();
    if (tk) headers['Authorization'] = 'Bearer ' + tk;
    let body = original.body;
    if (body && typeof body !== 'string') body = JSON.stringify(body);
    if (body) headers['Content-Type'] = 'application/json';
    const attempts = retry ? MAX_RETRIES + 1 : 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
      try {
        const requestOpts = Object.assign({}, original, { headers, body });
        if (controller) requestOpts.signal = controller.signal;
        const r = await fetch(API_BASE + path, requestOpts);
        if (timer) clearTimeout(timer);
        if (r.status === 401) { setToken(null); throw new Error('unauthorized'); }
        if (!r.ok) {
          let m = 'http ' + r.status;
          try { m = (await r.json()).error || m; } catch (e) {}
          if (attempt + 1 < attempts && RETRYABLE_STATUS.has(r.status)) {
            await wait(250 * (attempt + 1));
            continue;
          }
          throw new Error(m);
        }
        return r.status === 204 ? {} : r.json();
      } catch (e) {
        if (timer) clearTimeout(timer);
        const retryableError = e.name === 'AbortError' || e.name === 'TypeError' || /network|fetch/i.test(e.message || '');
        if (attempt + 1 < attempts && retryableError) {
          await wait(250 * (attempt + 1));
          continue;
        }
        throw new Error(e.name === 'AbortError' ? '请求超时，请检查网络后重试' : (e.message || '网络请求失败'));
      }
    }
    throw new Error('网络请求失败');
  }

  window.Cloud = {
    base: API_BASE,
    available() { return !!API_BASE; },
    logout() { setToken(null); },

    // 学员
    async register(p) { const d = await req('/trainee/register', { method: 'POST', body: p }); setToken(d.token); return d.profile; },
    async login(emp) { const d = await req('/trainee/login', { method: 'POST', body: { emp } }); setToken(d.token); return d.profile; },
    async me() { return req('/trainee/me'); },
    async saveTraining(rec) {
      return req('/training', {
        method: 'POST', body: rec, retry: true,
        headers: rec && rec.id ? { 'X-Idempotency-Key': String(rec.id) } : {}
      });
    },
    async myTrainings() { return req('/training/mine'); },

    // 管理员
    async adminLogin(p) { const d = await req('/admin/login', { method: 'POST', body: p }); setToken(d.token); return d.profile; },
    async adminRecords() { return req('/admin/records'); },
    async adminTrainees() { return req('/admin/trainees'); }
  };
})();
