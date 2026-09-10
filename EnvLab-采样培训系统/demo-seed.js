/*!
 * EnvLab 演示站 · 培训记录预置脚本（逻辑层）
 *
 * 配合 demo-seed-data.js（构建时由真实模块 JSON 生成）使用：
 *   数据层给出完整记录；本脚本只负责"在没有记录时写入"。
 *
 * 为什么需要：
 *   培训/采样两个系统在无后端时走 localStorage 本机模式。公网演示站是纯静态的，
 *   没有 Node 后端 → 访客打开记录台是空的，看不到"学员记录 / 得分 / 红线次数 /
 *   训练证明"这条能力链。预置若干条构造记录让这条链路可见。
 *
 * 设计原则：
 *   1. 只在对应键为空时写入；已有数据（含访客自己产生的）一律不动
 *   2. 记录由真实模块 JSON 生成（题干、红线位置、passThreshold 均取自源码），
 *      分数按同一套规则算（score=平均得分×100，passed=无红线且≥passThreshold）
 *   3. 不删除任何东西；记录台本身仍提供"清空"按钮
 *   4. 是"演示数据"不是"伪造数据"：页面已注明演示用途
 */
(function () {
  var D = window.ENVLAB_DEMO_DATA;
  if (!D) return;

  function read(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function put(k, v) {
    if (read(k) && read(k).length) return;   // 已有数据 → 不动
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }

  put('envlab_training_records', D.training || []);
  put('envlab_sampling_records', D.sampling || []);
  put('envlab_profiles', D.profiles || []);

  // 记录台登录页给一句提示，否则访客不知道账号
  function hint() {
    var el = document.getElementById('loginWrap');
    if (!el || document.getElementById('demoCredHint')) return;
    var n = (D.training || []).length + (D.sampling || []).length;
    var d = document.createElement('div');
    d.id = 'demoCredHint';
    d.style.cssText = 'margin:0 0 14px;padding:11px 14px;border-radius:10px;' +
      'background:#eefcf5;border:1px solid #bfead9;color:#0c4a36;font-size:13px;line-height:1.7';
    d.innerHTML = '<b>演示账号</b>：姓名 <code>ENVLAB</code> / 工号 <code>001</code>。' +
      '本站为公网演示，记录台已预置 ' + n + ' 条构造记录（由真实课程模块生成）；' +
      '实际部署接入后端后即为真实记录。';
    el.insertBefore(d, el.firstChild);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hint);
  } else {
    hint();
  }
})();
