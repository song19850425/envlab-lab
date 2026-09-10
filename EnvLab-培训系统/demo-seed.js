/*!
 * EnvLab 演示站 · 培训记录预置脚本
 *
 * 为什么需要它：
 *   培训系统在无后端时走 localStorage 本机模式。公网演示站（GitHub Pages）
 *   没有 Node 后端，访客打开记录台会是空的 —— 看不到"学员记录 / 得分 / 红线次数 /
 *   训练证明"这条能力链。本脚本在首次打开时写入若干条演示记录，让这条链路可见。
 *
 * 设计原则：
 *   1. 只在记录为空时写入（localStorage 里已有数据则完全不动）
 *   2. 记录内容全部为构造数据，不含任何真实人员信息
 *   3. 不覆盖、不删除访客自己产生的记录；记录台仍可一键清空
 *   4. 是"演示数据"，不是"伪造数据"：页面已注明演示用途
 */
(function () {
  var LS_KEY = 'envlab_training_records';
  var LS_PROFILES = 'envlab_profiles';
  var SEED_FLAG = 'envlab_demo_seed_v1';

  function read(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var existing = read(LS_KEY);
  if (existing && existing.length) return;      // 已有记录 → 不干预

  var LAB = '某市环境检测中心 · 理化室';
  var now = Date.now();
  var H = 3600 * 1000;

  function rec(o) {
    return {
      id: 'DEMO-' + o.emp + '-' + o.instrumentId,
      ts: new Date(now - o.agoH * H).toISOString(),
      emp: o.emp,
      trainee: o.trainee,
      lab: LAB,
      instrumentId: o.instrumentId,
      instrumentName: o.instrumentName,
      model: o.model,
      durationSec: o.durationSec,
      score: o.score,
      fatalHits: o.fatalHits,
      passed: o.fatalHits === 0 && o.score >= 80,
      steps: o.steps || []
    };
  }

  var records = [
    rec({
      trainee: '张工', emp: 'CJ-0213', agoH: 26, durationSec: 742,
      instrumentId: 'aas-900t', instrumentName: '原子吸收分光光度计', model: 'AAS-900T',
      score: 92, fatalHits: 0,
      steps: [
        { q: '开机顺序（先气后电）', correct: true, partial: false, credit: 1 },
        { q: '空心阴极灯预热与波长选择', correct: true, partial: false, credit: 1 },
        { q: '标准曲线配制与测定', correct: true, partial: true, credit: 0.6 },
        { q: '样品测定与结果计算', correct: true, partial: false, credit: 1 },
        { q: '关机顺序与记录填写', correct: true, partial: false, credit: 1 }
      ]
    }),
    rec({
      trainee: '李工', emp: 'CJ-0214', agoH: 25, durationSec: 508,
      instrumentId: 'uv-vis-l5s', instrumentName: '紫外可见分光光度计', model: 'L5S',
      score: 100, fatalHits: 0,
      steps: [
        { q: '比色皿方向与空白校正', correct: true, partial: false, credit: 1 },
        { q: '波长设定', correct: true, partial: false, credit: 1 },
        { q: '标准曲线与线性检验', correct: true, partial: false, credit: 1 },
        { q: '样品测定', correct: true, partial: false, credit: 1 },
        { q: '数据记录与复核', correct: true, partial: false, credit: 1 }
      ]
    }),
    rec({
      trainee: '王工', emp: 'CJ-0221', agoH: 8, durationSec: 366,
      instrumentId: 'balance-ms105du', instrumentName: '十万分之一天平', model: 'MS105DU',
      score: 55, fatalHits: 2,
      steps: [
        { q: '水平检查与预热（未预热即称量 —— 致命）', correct: false, partial: false, credit: 0 },
        { q: '防风罩与静电消除（未消除 —— 致命）', correct: false, partial: false, credit: 0 },
        { q: '内校砝码校正', correct: true, partial: false, credit: 1 },
        { q: '称量操作与读数', correct: true, partial: true, credit: 0.6 },
        { q: '记录填写', correct: true, partial: false, credit: 1 }
      ]
    }),
    rec({
      trainee: '赵工', emp: 'CJ-0226', agoH: 3, durationSec: 615,
      instrumentId: 'sampler-qcs6000', instrumentName: '四气路大气采样器', model: 'QCS6000',
      score: 86, fatalHits: 0,
      steps: [
        { q: '流量校准', correct: true, partial: false, credit: 1 },
        { q: '吸收液与吸附管准备', correct: true, partial: true, credit: 0.6 },
        { q: '采样时间与体积记录', correct: true, partial: false, credit: 1 },
        { q: '样品封存与交接', correct: true, partial: false, credit: 1 },
        { q: '现场空白', correct: true, partial: false, credit: 1 }
      ]
    }),
    rec({
      trainee: '张工', emp: 'CJ-0213', agoH: 2, durationSec: 690,
      instrumentId: 'incubator-spx250', instrumentName: '生化培养箱', model: 'SPX-250B-Z',
      score: 88, fatalHits: 0,
      steps: [
        { q: '温度设定与稳定确认', correct: true, partial: false, credit: 1 },
        { q: '培养基与器皿准备', correct: true, partial: false, credit: 1 },
        { q: '接种与培养条件', correct: true, partial: true, credit: 0.6 },
        { q: '培养过程记录', correct: true, partial: false, credit: 1 },
        { q: '结果判读与清场', correct: true, partial: false, credit: 1 }
      ]
    })
  ];

  write(LS_KEY, records);

  // 学员名册（供学员端登录演示）
  if (!read(LS_PROFILES)) {
    write(LS_PROFILES, [
      { name: '张工', emp: 'CJ-0213', lab: LAB, phone: '', role: 'trainee' },
      { name: '李工', emp: 'CJ-0214', lab: LAB, phone: '', role: 'trainee' },
      { name: '王工', emp: 'CJ-0221', lab: LAB, phone: '', role: 'trainee' }
    ]);
  }

  try { localStorage.setItem(SEED_FLAG, '1'); } catch (e) {}

  // 记录台登录页给一句提示，否则访客不知道账号
  function hint() {
    var el = document.getElementById('loginWrap');
    if (!el || document.getElementById('demoCredHint')) return;
    var d = document.createElement('div');
    d.id = 'demoCredHint';
    d.style.cssText = 'margin:0 0 14px;padding:11px 14px;border-radius:10px;' +
      'background:#eefcf5;border:1px solid #bfead9;color:#0c4a36;font-size:13px;line-height:1.7';
    d.innerHTML = '<b>演示账号</b>：姓名 <code>ENVLAB</code> / 工号 <code>001</code>（本页为公网演示，' +
      '记录已预置 5 条构造数据；真实部署时接入后端后为真实记录）。';
    el.insertBefore(d, el.firstChild);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hint);
  } else {
    hint();
  }
})();
