/* =====================================================================
   inquiry-lab-engine.js — EnvLab 开放式探究引擎（配置驱动）
   ---------------------------------------------------------------------
   用法：课程页先定义 window.EnvLabInquiry，再引入本文件。
   流程：① 提出问题 → ② 自主设计方案 → ③ 预注册预期与判据
         → ④ 生成数据并分析 → ⑤ 结论与报告量规
   设计要点：
     · 数据由「方案指纹」播种的确定性伪随机生成 —— 同一方案永远得到同一组
       数据，学生可复现，教师可复核。
     · 引擎不判对错，只呈现「方案 → 数据 → 结论」之间的因果链。
     · 所有用户输入渲染一律走 esc()。
   依赖：无（纯原生 JS，离线可用）
   ===================================================================== */
(function () {
  "use strict";

  var cfg = window.EnvLabInquiry;
  if (!cfg) { return; }

  /* ================= 1. 基础工具 ================= */
  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function $(s, r) { return (r || document).querySelector(s); }
  function byId(arr, id) { if (!arr) { return null; } for (var i = 0; i < arr.length; i++) { if (arr[i].id === id) { return arr[i]; } } return null; }
  function fx(v, d) { return Number(v).toFixed(d == null ? 1 : d); }
  function has(arr, v) { return arr && arr.indexOf(v) >= 0; }

  /* 确定性伪随机：FNV-1a 播种 + mulberry32 */
  function hashSeed(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { return r() + r() - 1; } /* 两次均匀求和：教学够用的近似正态 */

  /* ================= 2. 状态 ================= */
  var DIMS = cfg.dimensions || [];
  var MODEL = cfg.model || {};
  var IND = MODEL.indicators || {};
  var LS = cfg.storageKey || "envlab.inquiry";

  function dim(id) { return byId(DIMS, id); }
  function opt(dimId, optId) { var d = dim(dimId); return d ? byId(d.options, optId) : null; }
  function blank() {
    var sel = {};
    DIMS.forEach(function (d) { sel[d.id] = []; });
    return {
      step: 1, q: null, qCustom: "", hypo: "",
      sel: sel, expect: null, criterion: "",
      ran: false, data: null, conclusion: "", rub: {}, stamp: null
    };
  }
  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) { s = null; }
    if (!s || typeof s !== "object" || !s.sel) { return null; }
    var b = blank();
    /* 合并（容忍配置变更后残留的旧状态） */
    for (var k in b) { if (s[k] === undefined) { s[k] = b[k]; } }
    DIMS.forEach(function (d) {
      var cur = s.sel[d.id];
      if (!Array.isArray(cur)) { cur = []; }
      s.sel[d.id] = cur.filter(function (id) { return !!byId(d.options, id); });
    });
    if (s.q && !byId(cfg.questions, s.q)) { s.q = null; }
    if (s.expect && !byId(cfg.expects, s.expect)) { s.expect = null; }
    if (typeof s.step !== "number" || s.step < 1 || s.step > 5) { s.step = 1; }
    return s;
  }
  var S = load() || blank();

  function save() {
    try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) { /* 隐私模式等：静默降级 */ }
  }

  /* ================= 3. 方案计算 ================= */
  function selOf(dimId) { if (!S.sel[dimId]) { S.sel[dimId] = []; } return S.sel[dimId]; }
  function one(dimId) { var a = selOf(dimId); return a.length ? a[0] : null; }

  function totalCost() {
    var t = 0;
    DIMS.forEach(function (d) {
      selOf(d.id).forEach(function (oid) { var o = byId(d.options, oid); if (o) { t += (o.cost || 0); } });
    });
    return t;
  }
  function overBudget() { return totalCost() > (cfg.budget || 0); }

  function replicateN() {
    var d = dim(cfg.replicateDim || "freq");
    if (!d) { return 1; }
    var o = opt(d.id, one(d.id));
    return (o && o.n) ? o.n : 1;
  }
  function qcFactor() {
    var prec = 1, bias = (MODEL.baseBias || 0);
    var d = dim("qcs");
    if (d) {
      selOf("qcs").forEach(function (qid) {
        var q = byId(d.options, qid);
        if (!q) { return; }
        if (q.precision != null) { prec *= q.precision; }
        if (q.bias != null) { bias += q.bias; }
      });
    }
    return { prec: prec, bias: bias };
  }
  function fingerprint() {
    var parts = [];
    DIMS.forEach(function (d) { parts.push(d.id + "=" + selOf(d.id).slice().sort().join("+")); });
    parts.push("q=" + (S.q || "custom"));
    return parts.join("|");
  }
  function selIndicatorIds() { return selOf("inds").filter(function (id) { return !!IND[id]; }); }
  function selSiteIds() {
    var d = dim("sites");
    return selOf("sites").filter(function (id) { return !!(d && byId(d.options, id)); });
  }

  /* 单点不确定度：u = u0 × 质控精度因子 / √n + 基准值 × 偏差因子 */
  function unc(iid, baseVal) {
    var ind = IND[iid], f = qcFactor();
    var u = ind.u0 * f.prec / Math.sqrt(replicateN()) + baseVal * f.bias;
    return Math.max(u, 0);
  }

  /* ================= 4. 数据生成 ================= */
  function gen() {
    var r = makeRng(hashSeed(fingerprint()));
    var inds = selIndicatorIds(), sites = selSiteIds();
    var n = replicateN(), f = qcFactor();

    function observe(trueVal, iid) {
      var ind = IND[iid];
      var sd = ind.u0 / Math.max(ind.base || ind.u0, 1e-9);
      return trueVal * (1 + gauss(r) * Math.min(sd, 0.4));
    }
    function pack(iid, trueVal) {
      return { v: observe(trueVal, iid), u: unc(iid, trueVal) };
    }

    var out = { inds: inds, sites: sites, n: n, prec: f.prec, bias: f.bias, rows: [], groups: [] };

    if (MODEL.kind === "gradient") {
      sites.forEach(function (sid) {
        var sf = (MODEL.siteFactor || {})[sid] || { _d: 1 };
        var sopt = opt("sites", sid);
        var row = { id: sid, name: sopt ? sopt.name : sid, role: sopt ? sopt.role : "", cells: {} };
        inds.forEach(function (iid) {
          var k = (sf[iid] != null) ? sf[iid] : (sf._d != null ? sf._d : 1);
          row.cells[iid] = pack(iid, IND[iid].base * k);
        });
        out.rows.push(row);
      });
    } else {
      /* matrix：站点 × 时段 */
      var periods = selOf("periods");
      out.periods = periods;
      sites.forEach(function (sid) {
        var sopt = opt("sites", sid);
        var row = { id: sid, name: sopt ? sopt.name : sid, role: sopt ? sopt.role : "", cells: {} };
        inds.forEach(function (iid) {
          row.cells[iid] = {};
          var m = (MODEL.matrix || {})[iid];
          periods.forEach(function (pid) {
            var tv = (m && m[sid] && m[sid][pid] != null) ? m[sid][pid] : null;
            row.cells[iid][pid] = (tv == null) ? null : pack(iid, tv);
          });
        });
        out.rows.push(row);
      });
      /* 派生指标：从主指标按偏移量推出（如 Lmax = Leq + 5.5） */
      inds.forEach(function (iid) {
        var ind = IND[iid];
        if (!ind.derive) { return; }
        var src = ind.derive.from;
        out.rows.forEach(function (row) {
          periods.forEach(function (pid) {
            var base = row.cells[src] && row.cells[src][pid];
            if (!base) { row.cells[iid][pid] = null; return; }
            var tv = base.v + (ind.derive.add || 0);
            var c = pack(iid, tv);
            c.from = src;
            row.cells[iid][pid] = c;
          });
        });
      });
    }
    out.stamp = Date.now();
    return out;
  }

  /* ================= 5. 判定 ================= */
  var V_OK = 'ok', V_WARN = 'warn', V_BAD = 'bad', V_NA = 'na';

  function judgeAll() {
    var D = S.data;
    if (!D) { return null; }
    if (MODEL.judge === "difference") {
      var ctrl = MODEL.control;
      var hasCtrl = D.sites.indexOf(ctrl) >= 0;
      var kSig = MODEL.kSig || 2;
      var groups = [], sigInds = 0, judged = 0;
      D.inds.forEach(function (iid) {
        var ind = IND[iid];
        var g = { iid: iid, ind: ind, hasCtrl: hasCtrl, items: [], sig: false, anyJudged: false };
        var cRow = null;
        D.rows.forEach(function (r) { if (r.id === ctrl) { cRow = r; } });
        D.rows.forEach(function (r) {
          if (r.id === ctrl) { return; }
          var a = r.cells[iid], b = cRow ? cRow.cells[iid] : null;
          if (!a) { return; }
          if (!b) { g.items.push({ site: r.name, role: r.role, na: true }); return; }
          var diff = a.v - b.v;
          var u = Math.sqrt(a.u * a.u + b.u * b.u);
          var k = u > 0 ? Math.abs(diff) / u : 99;
          var vd = k >= kSig ? V_OK : (k >= 1 ? V_WARN : V_NA);
          var label = k >= kSig ? "可识别差异" : (k >= 1 ? "疑似差异（证据不足）" : "无法区分");
          if (k >= kSig) { g.sig = true; }
          g.anyJudged = true;
          g.items.push({
            site: r.name, role: r.role, v: a.v, u: a.u, cv: b.v, cu: b.u,
            diff: diff, k: k, vd: vd, label: label,
            dir: diff > 0 ? "up" : "down"
          });
        });
        judged++;
        if (g.sig) { sigInds++; }
        groups.push(g);
      });
      var outcome = judged === 0 ? "none" : (sigInds === 0 ? "none" : (sigInds === judged ? "all" : "partial"));
      return { kind: "difference", groups: groups, outcome: outcome, hasCtrl: hasCtrl, kSig: kSig, judged: judged };
    }

    /* compliance：测定值 ± 不确定度 与限值比对 */
    var cells = [], over = 0, total = 0, indsOver = {};
    D.inds.forEach(function (iid) {
      var ind = IND[iid];
      if (!ind.comparable) { return; }
      var lim = (ind.limit != null) ? ind.limit : MODEL.limit;
      D.rows.forEach(function (row) {
        (D.periods || []).forEach(function (pid) {
          var c = row.cells[iid] && row.cells[iid][pid];
          if (!c) { return; }
          var lo = c.v - c.u, hi = c.v + c.u;
          var vd, label;
          if (lo > lim) { vd = V_BAD; label = "明确超限"; over++; indsOver[iid] = true; }
          else if (hi < lim) { vd = V_OK; label = "明确达标"; }
          else { vd = V_WARN; label = "临界（不确定度跨限值）"; }
          total++;
          cells.push({
            iid: iid, ind: ind, site: row.name, sid: row.id, pid: pid,
            period: (opt("periods", pid) || {}).name || pid,
            v: c.v, u: c.u, lo: lo, hi: hi, limit: lim, vd: vd, label: label
          });
        });
      });
    });
    var indCount = 0; D.inds.forEach(function (iid) { if (IND[iid] && IND[iid].comparable) { indCount++; } });
    var outcome = total === 0 ? "none" : (over === 0 ? "none" : (over === total ? "all" : "partial"));
    return { kind: "compliance", cells: cells, outcome: outcome, over: over, total: total, indCount: indCount };
  }

  /* ================= 6. 方案体检（事实提示，不评分） ================= */
  function designCheck() {
    var out = [];
    var inds = selIndicatorIds(), sites = selSiteIds();
    var q = byId(cfg.questions, S.q);
    var siteDim = dim("sites");

    var ctrlIds = [];
    if (siteDim) {
      siteDim.options.forEach(function (o) { if (o.role === "control") { ctrlIds.push(o.id); } });
    }
    var hasCtrl = sites.some(function (s) { return has(ctrlIds, s); });

    if (inds.length === 0) {
      out.push({ k: "bad", t: "还没有选任何指标 —— 没有指标就没有数据。" });
    } else if (q && q.keyIndicators && q.keyIndicators.length) {
      var miss = q.keyIndicators.filter(function (k) { return !has(inds, k); });
      if (miss.length === 0) {
        out.push({ k: "good", t: "你选的指标覆盖了这个问题需要的全部关键项。" });
      } else {
        var names = miss.map(function (k) { return (IND[k] && IND[k].label) || k; }).join("、");
        out.push({ k: "warn", t: "针对你提出的问题，还缺关键指标：<b>" + esc(names) + "</b>。只测现有这些，数据可能回答不了你的问题。" });
      }
    }

    /* 派生指标必须先有主指标，否则一行数据都出不来 */
    inds.forEach(function (iid) {
      var ind = IND[iid];
      if (ind && ind.derive && !has(inds, ind.derive.from)) {
        var srcN = (IND[ind.derive.from] && IND[ind.derive.from].label) || ind.derive.from;
        out.push({ k: "bad", t: "「<b>" + esc(ind.label || iid) + "</b>」是由「" + esc(srcN) + "」推算出来的。你选了前者却没选后者，这一项不会产生任何数据。" });
      }
    });

    if (sites.length === 0) {
      out.push({ k: "bad", t: "还没有选任何点位。" });
    } else {
      if (!hasCtrl) {
        out.push({ k: "warn", t: "没有设<b>对照点</b>。没有对照，就只能说「测到了多少」，说不了「变差了没有」——差异判定会失效。" });
      } else {
        out.push({ k: "good", t: "设了对照点，可以做前后/上下游比较。" });
      }
      if (sites.length < 3) {
        out.push({ k: "warn", t: "只布了 " + sites.length + " 个点位，看不出空间分布，也分不清「局部异常」和「整段污染」。" });
      } else {
        out.push({ k: "good", t: "点位数量 " + sites.length + " 个，能看出空间梯度。" });
      }
    }

    if (replicateN() < 2) {
      out.push({ k: "warn", t: "每点位只测 <b>1 次</b>，拿不到重复性，也就给不出不确定度。" });
    } else {
      out.push({ k: "good", t: "每点位重复 " + replicateN() + " 次，可以估计不确定度。" });
    }

    var qcN = selOf("qcs").length;
    if (qcN === 0) {
      out.push({ k: "warn", t: "一项质控都没做。数据里的系统偏差不会被发现，结论只能当定性参考。" });
    } else if (qcN >= 2) {
      out.push({ k: "good", t: "选了 " + qcN + " 项质控，偏差与精密度都有交代。" });
    } else {
      out.push({ k: "warn", t: "只有 1 项质控，建议再补一项（空白 + 平行 + 加标 三件套里挑）。" });
    }

    var c = totalCost(), b = cfg.budget || 0;
    if (c > b) {
      out.push({ k: "bad", t: "预算超支 <b>" + (c - b) + "</b> 单位，必须砍掉一些项目。" });
    } else {
      out.push({ k: "good", t: "预算 " + c + " / " + b + " 单位，未超支。" });
    }
    return out;
  }

  /* ================= 7. 探究等级 ================= */
  function inquiryLevel() {
    var inds = selIndicatorIds(), sites = selSiteIds();
    var siteDim = dim("sites"), ctrlIds = [];
    if (siteDim) { siteDim.options.forEach(function (o) { if (o.role === "control") { ctrlIds.push(o.id); } }); }
    var checks = [
      { t: "自己提出了要回答的问题", ok: !!S.q || (S.qCustom || "").trim().length >= 6 },
      { t: "自主选择了监测指标（≥2 项）", ok: inds.length >= 2 },
      { t: "设计了对照（背景/空白点位）", ok: sites.some(function (s) { return has(ctrlIds, s); }) },
      { t: "覆盖了 3 个以上点位（空间代表性）", ok: sites.length >= 3 },
      { t: "有重复测量（可估不确定度）", ok: replicateN() >= 2 },
      { t: "做了 2 项以上质控", ok: selOf("qcs").length >= 2 },
      { t: "事先写明了判定标准（预注册）", ok: (S.criterion || "").trim().length >= 10 }
    ];
    var sc = checks.filter(function (c) { return c.ok; }).length;
    var lvl = sc <= 2
      ? { n: "0–1", nm: "验证性探究", d: "问题与方法基本由别人给定，你只执行了一遍。这是课堂演示的形态，还不是探究。" }
      : (sc <= 4
        ? { n: "2", nm: "引导性探究", d: "问题是你自己提的，方法也自主了一部分。已经离开「照方抓药」，但方案还不完整。" }
        : (sc <= 6
          ? { n: "3", nm: "开放性探究", d: "问题、方法、判据基本自主，方案完整到可以执行。这正是英美实验课改革要到的位置。" }
          : { n: "3+", nm: "开放性探究（方案完整）", d: "问题、方法、判据全部自主且互相咬合。这份方案已经可以直接拿去真实课题立项。" }));
    var next = checks.filter(function (c) { return !c.ok; }).slice(0, 2).map(function (c) { return c.t; });
    return { checks: checks, score: sc, max: checks.length, lvl: lvl, next: next };
  }

  /* ================= 8. 渲染 ================= */
  var root = null;

  function shell(inner) {
    return '<div class="iq-noprint">' + rail() + '</div>' +
      '<div class="iq-body">' + inner + '</div>' +
      '<div id="iq-print"></div>';
  }
  var STEPS = [
    { n: 1, t: "提出问题" }, { n: 2, t: "设计方案" }, { n: 3, t: "预注册" },
    { n: 4, t: "数据与分析" }, { n: 5, t: "结论与报告" }
  ];
  function rail() {
    return '<div class="iq-rail" role="tablist" aria-label="探究步骤">' + STEPS.map(function (s) {
      var cls = S.step === s.n ? "on" : (S.step > s.n ? "done" : "");
      var lock = s.n > maxReached() ? " disabled" : "";
      return '<button type="button" role="tab" class="' + cls + '"' + lock +
        ' aria-selected="' + (S.step === s.n) + '" data-act="go" data-step="' + s.n + '">' +
        '<span class="rn">0' + s.n + '</span><span>' + s.t + '</span></button>';
    }).join("") + '</div>';
  }
  function maxReached() {
    if (S.step >= 5) { return 5; }
    if (S.step >= 4 && S.ran) { return 5; }
    if (S.step >= 4) { return 4; }
    if (S.step >= 3) { return 3; }
    if (S.step >= 2) { return 2; }
    return 1;
  }
  function stepHead(n, t, sub) {
    return '<div class="iq-h"><span style="font-family:var(--mono);color:var(--acc2);font-size:12px">STEP 0' + n + '</span> · ' + esc(t) + '</div>' +
      '<div class="iq-sub">' + sub + '</div>';
  }
  function err(msg) { return '<div class="iq-err"' + (msg ? '' : ' hidden') + '>' + (msg || '') + '</div>'; }
  /* 按钮条：兼容 acts("a","b") 与 acts(["a","b"]) 两种写法 */
  function acts(list) {
    var arr = Array.isArray(list) ? list : Array.prototype.slice.call(arguments);
    return '<div class="iq-acts">' + arr.join("") + '</div>';
  }

  /* ---- STEP 1 ---- */
  function vStep1() {
    var qOpts = (cfg.questions || []).map(function (q) {
      return '<button type="button" data-act="pickQ" data-opt="' + esc(q.id) + '" aria-pressed="' + (S.q === q.id) + '">' +
        '<span class="pk"></span><span class="pt"><b>' + esc(q.text) + '</b><span>' + esc(q.desc || "") + '</span></span></button>';
    }).join("");
    var custom = '<button type="button" data-act="pickQ" data-opt="__custom" aria-pressed="' + (S.q === "__custom") + '">' +
      '<span class="pk"></span><span class="pt"><b>我自己提一个问题</b><span>把你要回答的问题写下来——这是开放性探究的起点</span></span></button>';
    return shell(
      stepHead(1, "提出问题：这次调查到底要回答什么？",
        "同一个现场，问题不同，要测的东西就完全不同。先定问题，再定方案——<b>顺序反了，方案就是抄的</b>。") +
      '<div class="iq-f"><span class="iq-lb">驱动问题<span class="req">*</span></span><div class="iq-pick">' + qOpts + custom + '</div></div>' +
      '<div class="iq-f" id="iqCustomWrap"' + (S.q === "__custom" ? '' : ' hidden') + '>' +
        '<label class="iq-lb" for="iqQCustom">你的问题</label>' +
        '<textarea class="iq-ta" id="iqQCustom" data-field="qCustom" maxlength="200" placeholder="例：这个河段的有机污染是否已经影响到下游取水口？">' + esc(S.qCustom) + '</textarea>' +
        '<div class="iq-count">建议写成"是否 / 哪个 / 多少"能回答的句子，不要写成"研究一下 XX"。</div>' +
      '</div>' +
      '<div class="iq-f"><label class="iq-lb" for="iqHypo">你的预判（假设）<span class="hint">先猜，再验——猜错比不猜有价值</span><span class="req">*</span></label>' +
        '<textarea class="iq-ta" id="iqHypo" data-field="hypo" maxlength="400" placeholder="例：我预计下游氨氮和粪大肠菌群明显高于上游，重金属不会有明显变化，因为沿岸没有明显工业排口。">' + esc(S.hypo) + '</textarea>' +
        '<div class="iq-count"><span data-count="hypo">' + (S.hypo || "").length + '</span> / 400</div></div>' +
      '<div class="qt"><b>为什么必须先写预判？</b>看到数据之后再"解释"，人总能编出一个说得通的故事（这叫事后归因）。先把预判写下来，数据才有检验的对象。</div>' +
      acts('<button class="iq-btn" type="button" data-act="next">下一步 · 设计我的方案 →</button>') +
      err("")
    );
  }

  /* ---- STEP 2 ---- */
  function vStep2() {
    var c = totalCost(), b = cfg.budget || 0, pct = Math.min(100, Math.round(c / b * 100));
    var bud = '<div class="iq-bud' + (overBudget() ? ' over' : '') + '">' +
      '<div class="iq-bud-hd"><span class="iq-bud-t">方案预算</span>' +
      '<span class="iq-bud-n">' + c + '<small> / ' + b + ' 单位</small></span></div>' +
      '<div class="iq-bud-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="iq-bud-note">' + (overBudget()
        ? '已超支 ' + (c - b) + ' 单位，必须取舍。'
        : '剩余 ' + (b - c) + ' 单位。预算约束是真实的——现场只给你这么多人力、耗材和时间。') + '</div></div>';

    var dimsHtml = DIMS.map(function (d) {
      var picked = selOf(d.id);
      var isMulti = d.multi !== false;
      var two = d.options.length === 4 || d.options.length === 6 ? " two" : (d.options.length === 3 ? " three" : "");
      var opts = d.options.map(function (o) {
        var on = has(picked, o.id);
        return '<button type="button" class="iq-opt" data-act="pick" data-dim="' + esc(d.id) + '" data-opt="' + esc(o.id) + '" aria-pressed="' + on + '">' +
          '<span class="bx' + (isMulti ? '' : ' rd') + '"></span>' +
          '<span class="ot"><b>' + esc(o.name) + '</b>' + (o.desc ? '<span>' + esc(o.desc) + '</span>' : '') + '</span>' +
          '<span class="oc' + (o.cost ? '' : ' free') + '">' + (o.cost ? o.cost + ' 单位' : '免费') + '</span></button>';
      }).join("");
      var cap = isMulti ? ('可多选' + (d.max ? '，最多 ' + d.max + ' 项' : '')) : '单选';
      return '<div class="iq-dim"><div class="iq-dim-hd"><span class="iq-dim-t">' + esc(d.name) + '</span>' +
        '<span class="iq-dim-c">' + cap + ' · 已选 ' + picked.length + '</span></div>' +
        (d.desc ? '<div class="iq-dim-d">' + d.desc + '</div>' : '') +
        '<div class="iq-opts' + two + '">' + opts + '</div></div>';
    }).join("");

    var chk = designCheck();
    var chkHtml = '<div class="iq-chk"><div class="iq-chk-t">方案体检（只报事实，不替你决定）</div><ul>' +
      chk.map(function (x) { return '<li class="' + x.k + '">' + x.t + '</li>'; }).join("") + '</ul></div>';

    return shell(
      stepHead(2, "自主设计方案：把问题翻译成可执行的采样计划",
        "预算 " + b + " 单位。没有「标准方案」——但每个选择都有代价，方案体检会把代价摆给你看。") +
      bud + dimsHtml + chkHtml +
      acts(
        '<button class="iq-btn ghost" type="button" data-act="go" data-step="1">← 回到问题</button>' +
        '<button class="iq-btn" type="button" data-act="next"' + (overBudget() ? ' disabled' : '') + '>下一步 · 预注册判据 →</button>'
      ) + err("")
    );
  }

  /* ---- STEP 3 ---- */
  function vStep3() {
    var eOpts = (cfg.expects || []).map(function (e) {
      return '<button type="button" data-act="pickE" data-opt="' + esc(e.id) + '" aria-pressed="' + (S.expect === e.id) + '">' +
        '<span class="pk"></span><span class="pt"><b>' + esc(e.text) + '</b><span>' + esc(e.desc || "") + '</span></span></button>';
    }).join("");
    var critHint = MODEL.judge === "difference"
      ? "提示：如果你做了重复测量和质控，可以用「<b>差异 &gt; 2 倍合并不确定度</b>」作为「可识别影响」的判据；没做质控，就只能说「疑似」。"
      : "提示：合规判定要看<b>不确定度区间</b>与限值的关系——区间整体高于限值才算「明确超限」，跨在限值上只能说「临界」。";
    return shell(
      stepHead(3, "预注册：先把「怎么算赢」写下来",
        "这一步在真实科研里叫 <b>pre-registration</b>。先定判据再看数据，是为了防止你事后把判据改成刚好能得出想要结论的样子。") +
      '<div class="iq-f"><span class="iq-lb">你的预期方向<span class="req">*</span></span><div class="iq-pick">' + eOpts + '</div></div>' +
      '<div class="iq-f"><label class="iq-lb" for="iqCrit">你的判定标准<span class="hint">写清楚：什么样的数据结果，你就下"有影响 / 超标"的结论</span><span class="req">*</span></label>' +
        '<textarea class="iq-ta" id="iqCrit" data-field="criterion" maxlength="400" placeholder="例：下游任一关键指标的测定值与上游对照的差异超过 2 倍合并不确定度，我就判定存在可识别影响。">' + esc(S.criterion) + '</textarea>' +
        '<div class="iq-count"><span data-count="criterion">' + (S.criterion || "").length + '</span> / 400　至少 10 字</div></div>' +
      '<div class="qt">' + critHint + '</div>' +
      acts(
        '<button class="iq-btn ghost" type="button" data-act="go" data-step="2">← 回到方案</button>' +
        '<button class="iq-btn" type="button" data-act="next">下一步 · 生成数据 →</button>'
      ) + err("")
    );
  }

  /* ---- STEP 4 ---- */
  function vStep4() {
    if (!S.ran || !S.data) {
      var c = totalCost();
      return shell(
        stepHead(4, "生成数据并分析",
          "方案已经锁定。点下面的按钮，系统按你的方案生成一组模拟数据。") +
        '<div class="iq-chk"><div class="iq-chk-t">你提交的方案</div><ul>' +
        DIMS.map(function (d) {
          var names = selOf(d.id).map(function (id) { var o = byId(d.options, id); return o ? o.name : id; });
          return '<li class="' + (names.length ? 'good' : 'bad') + '">' + esc(d.name) + '：' +
            (names.length ? esc(names.join("、")) : "未选") + '</li>';
        }).join("") +
        '<li class="good">总成本：' + c + ' / ' + (cfg.budget || 0) + ' 单位</li>' +
        '<li class="good">每点位重复次数：' + replicateN() + ' 次</li></ul></div>' +
        '<div class="qt"><b>数据是怎么来的？</b>数据由你的方案指纹（指标 + 点位 + 频次 + 质控）播种生成，<b>同一方案永远得到同一组数据</b>。所以换方案 → 换数据，你可以反复对比不同设计会看到什么。真实测量噪声按各指标的单次不确定度叠加。</div>' +
        acts('<button class="iq-btn ghost" type="button" data-act="go" data-step="3">← 改判据</button>' +
          '<button class="iq-btn" type="button" data-act="run">▶ 生成模拟数据</button>') + err("")
      );
    }

    var D = S.data, J = judgeAll();
    var body = '<div class="iq-chk" style="margin-top:0"><div class="iq-chk-t">本次数据的产生条件</div><ul>' +
      '<li class="good">每点位重复 ' + D.n + ' 次；质控精度因子 ' + fx(D.prec, 2) + '；未校正偏差 ' + fx(D.bias * 100, 0) + '%</li>' +
      '<li class="' + (D.bias > 0.05 ? 'warn' : 'good') + '">' +
      (D.bias > 0.05
        ? '你的质控没能把系统偏差压下来（' + fx(D.bias * 100, 0) + '% 仍未知），下面每个不确定度里都含这块'
        : '质控把系统偏差压到 ' + fx(D.bias * 100, 0) + '%，数据可用于定量判定') + '</li></ul></div>';

    if (J.kind === "difference") {
      if (!J.hasCtrl) {
        body += '<div class="iq-err">你没有选对照点，<b>差异判定无法进行</b>。这正是方案体检在第 2 步提醒过的事——没有对照，"变差了没有"这句话说不出口。回到第 2 步补一个对照点，再生成一次数据。</div>';
      }
      body += J.groups.map(function (g) {
        var ind = g.ind;
        var rows = g.items.map(function (it) {
          if (it.na) {
            return '<tr><td>' + esc(it.site) + '</td><td class="u">—</td><td class="u">—</td><td class="u">—</td><td><span class="vd na">无对照</span></td></tr>';
          }
          return '<tr><td>' + esc(it.site) + '</td>' +
            '<td class="v">' + fx(it.v, ind.decimals) + '</td>' +
            '<td class="u">±' + fx(it.u, ind.decimals) + '</td>' +
            '<td class="u">' + fx(it.k, 2) + '</td>' +
            '<td><span class="vd ' + it.vd + '">' + esc(it.label) + '</span></td></tr>';
        }).join("");
        return '<div class="iq-print-h">' + esc(ind.label || g.iid) + '　' + esc(ind.unit || "") +
          (ind.worseWhen === "low" ? '<span class="caps">越低越差</span>' : (ind.worseWhen === "high" ? '<span class="caps">越高越差</span>' : '')) + '</div>' +
          '<div class="iq-tw"><table class="iq-tb"><thead><tr><th>点位</th><th>测定值</th><th>不确定度</th><th>k = |Δ| / u<sub>合并</sub></th><th>判定</th></tr></thead><tbody>' +
          rows + '</tbody></table></div>';
      }).join("");
      body += '<div class="qt">判定规则：k ≥ ' + J.kSig + ' 记为「可识别差异」，1 ≤ k &lt; ' + J.kSig + ' 记为「疑似（证据不足）」，k &lt; 1 记为「无法区分」。k 小不代表没有污染，只代表<b>你这套方案分辨不出来</b>。</div>';
    } else {
      var byInd = {};
      J.cells.forEach(function (c) { (byInd[c.iid] = byInd[c.iid] || []).push(c); });
      body += Object.keys(byInd).map(function (iid) {
        var ind = IND[iid], list = byInd[iid];
        var periods = D.periods || [];
        var head = '<tr><th>点位</th>' + periods.map(function (p) {
          return '<th>' + esc((opt("periods", p) || {}).name || p) + '</th>';
        }).join("") + '</tr>';
        var rows = D.rows.map(function (row) {
          return '<tr' + (row.role === "control" ? ' class="ctrl"' : '') + '><td>' + esc(row.name) + '</td>' +
            periods.map(function (p) {
              var c = null;
              list.forEach(function (x) { if (x.sid === row.id && x.pid === p) { c = x; } });
              if (!c) { return '<td class="u">—</td>'; }
              return '<td class="v">' + fx(c.v, ind.decimals) + ' <span class="u">±' + fx(c.u, ind.decimals) + '</span><br>' +
                '<span class="vd ' + c.vd + '">' + esc(c.label) + '</span></td>';
            }).join("") + '</tr>';
        }).join("");
        return '<div class="iq-print-h">' + esc(ind.label || iid) + '　' + esc(ind.unit || "") +
          '　<span class="caps">教学示例判据 ' + fx(ind.limit != null ? ind.limit : MODEL.limit, ind.decimals) + ' ' + esc(ind.unit || "") + '</span></div>' +
          '<div class="iq-tw"><table class="iq-tb"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>';
      }).join("");
      var nonCmp = D.inds.filter(function (iid) { return IND[iid] && !IND[iid].comparable; });
      if (nonCmp.length) {
        body += '<div class="iq-print-h">背景与辅助量（不参与合规判定）</div><div class="iq-tw"><table class="iq-tb"><thead><tr><th>指标</th>' +
          (D.periods || []).map(function (p) { return '<th>' + esc((opt("periods", p) || {}).name || p) + '</th>'; }).join("") + '</tr></thead><tbody>' +
          nonCmp.map(function (iid) {
            var ind = IND[iid];
            var first = D.rows[0];
            return '<tr><td>' + esc(ind.label || iid) + '</td>' + (D.periods || []).map(function (p) {
              var c = first && first.cells[iid] && first.cells[iid][p];
              return '<td class="v">' + (c ? fx(c.v, ind.decimals) + ' <span class="u">±' + fx(c.u, ind.decimals) + '</span>' : '—') + '</td>';
            }).join("") + '</tr>';
          }).join("") + '</tbody></table></div>' +
          '<div class="qt">上表只显示第一个点位，用于判断"噪声是不是交通引起的"。完整数据见导出报告。</div>';
      }
      body += '<div class="qt">判定规则：测定值 ± 不确定度 整体高于限值 → <b>明确超限</b>；整体低于限值 → <b>明确达标</b>；区间跨在限值上 → <b>临界</b>，此时唯一的正确说法是"证据不足，需要加密测量"。本页限值为<b>教学示例</b>，不对应任何法规条文。</div>';
    }

    /* 预期 vs 数据 */
    var exp = byId(cfg.expects, S.expect);
    var same = exp && exp.outcome === J.outcome;
    var outName = { all: "全部关键项都显示差异/超限", none: "未发现差异/超限", partial: "只有部分显示差异/超限" }[J.outcome];
    body += '<div class="iq-vs">' +
      '<div><div class="vt">你事先的预期</div><div class="vb">' + (exp ? esc(exp.text) : "（未选）") + '</div>' +
      '<div class="vc" style="color:var(--mut)">你的判据：' + (S.criterion ? esc(S.criterion.slice(0, 60)) + (S.criterion.length > 60 ? "…" : "") : "（未写）") + '</div></div>' +
      '<div><div class="vt">数据实际表现</div><div class="vb">' + esc(outName) + '</div>' +
      '<div class="vc" style="color:' + (same ? "var(--ok)" : "var(--warn)") + '">' +
      (same ? "与你的预期一致" : "与你的预期不一致 —— 这比一致更有价值，值得写进结论") + '</div></div></div>';

    body += acts(
      '<button class="iq-btn ghost" type="button" data-act="go" data-step="2">← 改方案，重新生成</button>' +
      '<button class="iq-btn" type="button" data-act="next">下一步 · 写结论与自评 →</button>'
    );
    return shell(stepHead(4, "数据与分析", "下面是你的方案「生成」出来的数据。<b>先看判定，再看你想说的故事</b>——顺序反了，就是在给结论找数据。") + body + err(""));
  }

  /* ---- STEP 5 ---- */
  var RUB = [
    { id: "answer", t: "结论直接回答了我第 1 步提出的那个问题", auto: null },
    { id: "num", t: "用了具体数据（含不确定度）支持结论，而不是只说「偏高 / 偏低」", auto: function (s) { return /\d/.test(s) && /(±|\+ ?\/ ?-|不确定)/.test(s); } },
    { id: "limit", t: "说明了本次方案的局限（点位、频次、指标覆盖不足在哪）", auto: function (s) { return /(局限|不足|限制|未能|无法|仅|只测|没有测)/.test(s); } },
    { id: "cause", t: "区分了「相关」与「因果」（没有测的项目，不下因果结论）", auto: function (s) { return /(相关|因果|不能排除|无法排除|尚不能|证据不足|存疑)/.test(s); } },
    { id: "next", t: "给出了下一步建议（加密、补测、溯源、复核）", auto: function (s) { return /(建议|下一步|加密|补测|复测|溯源|复核|加测)/.test(s); } },
    { id: "fiction", t: "注明了本页数据为教学模拟、判据为示例", auto: function (s) { return /(教学|模拟|示例|虚构|演示)/.test(s); } }
  ];
  function vStep5() {
    var L = inquiryLevel();
    var rubHtml = RUB.map(function (r) {
      var auto = r.auto ? r.auto(S.conclusion || "") : null;
      var badge = r.auto
        ? '<span class="auto ' + (auto ? "pass" : "fail") + '" data-auto="' + esc(r.id) + '">' + (auto ? "文本中已检出" : "文本中未检出") + '</span>'
        : '<span class="auto manual">需自评</span>';
      return '<label><input type="checkbox" data-act="rub" data-opt="' + esc(r.id) + '"' + (S.rub[r.id] ? ' checked' : '') + '>' +
        '<span class="rt"><b>' + esc(r.t) + '</b>' + badge + '</span></label>';
    }).join("");

    var lvlHtml = '<div class="iq-lvl"><div class="iq-lvl-hd">' +
      '<span class="iq-lvl-badge">探究等级 ' + esc(L.lvl.n) + '</span>' +
      '<span class="iq-lvl-nm">' + esc(L.lvl.nm) + '</span>' +
      '<span class="iq-lvl-sc">' + L.score + ' / ' + L.max + ' 项自主</span></div>' +
      '<div class="iq-lvl-bd"><ul>' + L.checks.map(function (c) {
        return '<li class="' + (c.ok ? "yes" : "no") + '">' + esc(c.t) + '</li>';
      }).join("") + '</ul>' +
      '<div class="iq-lvl-tip">' + esc(L.lvl.d) +
      (L.next.length ? '　再补上「' + esc(L.next.join("」「")) + '」，等级还能往上走。' : '') + '</div></div></div>';

    return shell(
      stepHead(5, "结论与报告", "写结论。然后按下面的量规自评——其中有 5 项系统会先替你把文本扫一遍，检出结果标在每行右边。") +
      '<div class="iq-f"><label class="iq-lb" for="iqConc">你的结论与讨论<span class="req">*</span></label>' +
        '<textarea class="iq-ta" id="iqConc" data-field="conclusion" maxlength="1600" style="min-height:180px" placeholder="按这个顺序写：① 直接回答第 1 步的问题；② 用哪些数据（含不确定度）支持；③ 你的方案局限在哪；④ 哪些结论下不了、为什么；⑤ 下一步建议。">' + esc(S.conclusion) + '</textarea>' +
        '<div class="iq-count"><span data-count="conclusion">' + (S.conclusion || "").length + '</span> / 1600</div></div>' +
      lvlHtml +
      '<div class="iq-print-h">报告量规自评</div><div class="iq-rub">' + rubHtml + '</div>' +
      '<div class="iq-note"><b>关于这份报告：</b>本页所有数据由模型按你的方案生成，限值与判据均为<b>教学示例</b>，不构成法规限值引用、正式评价结论或考核依据。真实工作请以现行有效标准与现场实测数据为准。</div>' +
      acts(
        '<button class="iq-btn ghost" type="button" data-act="go" data-step="4">← 回到数据</button>' +
        '<button class="iq-btn" type="button" data-act="print">🖨 打印 / 导出报告</button>' +
        '<button class="iq-btn danger" type="button" data-act="reset">重置本次探究</button>'
      ) + err("")
    );
  }

  /* ================= 9. 打印报告 ================= */
  function buildReport() {
    var D = S.data, J = D ? judgeAll() : null, L = inquiryLevel();
    var q = byId(cfg.questions, S.q);
    var qText = S.q === "__custom" ? (S.qCustom || "（未填写）") : (q ? q.text : "（未选）");
    var exp = byId(cfg.expects, S.expect);
    var parts = [];
    parts.push('<div class="iq-print-t">' + esc(cfg.title) + ' · 探究报告</div>');
    parts.push('<div class="iq-print-s">EnvLab 开放式探究 · 生成时间 ' + new Date().toLocaleString("zh-CN") + ' · 数据由方案指纹确定性生成（教学模拟）</div>');

    parts.push('<div class="iq-print-h">一、问题与预判</div>');
    parts.push('<div class="iq-print-row"><b>驱动问题：</b>' + esc(qText) + '</div>');
    parts.push('<div class="iq-print-row"><b>事先预判：</b>' + (S.hypo ? esc(S.hypo) : "（未填）") + '</div>');
    parts.push('<div class="iq-print-row"><b>预期方向：</b>' + (exp ? esc(exp.text) : "（未选）") + '</div>');
    parts.push('<div class="iq-print-row"><b>判定标准：</b>' + (S.criterion ? esc(S.criterion) : "（未填）") + '</div>');

    parts.push('<div class="iq-print-h">二、方案</div>');
    DIMS.forEach(function (d) {
      var names = selOf(d.id).map(function (id) { var o = byId(d.options, id); return o ? o.name : id; });
      parts.push('<div class="iq-print-row"><b>' + esc(d.name) + '：</b>' + (names.length ? esc(names.join("、")) : "未选") + '</div>');
    });
    parts.push('<div class="iq-print-row"><b>总成本：</b>' + totalCost() + ' / ' + (cfg.budget || 0) + ' 单位　<b>每点位重复：</b>' + replicateN() + ' 次</div>');

    if (D && J) {
      parts.push('<div class="iq-print-h">三、数据与判定</div>');
      if (J.kind === "difference") {
        J.groups.forEach(function (g) {
          parts.push('<div class="iq-print-row"><b>' + esc(g.ind.label || g.iid) + '（' + esc(g.ind.unit || "") + '）</b></div>');
          parts.push('<div class="iq-tw"><table class="iq-tb"><thead><tr><th>点位</th><th>测定值</th><th>不确定度</th><th>k</th><th>判定</th></tr></thead><tbody>' +
            g.items.map(function (it) {
              if (it.na) { return '<tr><td>' + esc(it.site) + '</td><td colspan="4">无对照</td></tr>'; }
              return '<tr><td>' + esc(it.site) + '</td><td>' + fx(it.v, g.ind.decimals) + '</td><td>±' + fx(it.u, g.ind.decimals) + '</td><td>' + fx(it.k, 2) + '</td><td>' + esc(it.label) + '</td></tr>';
            }).join("") + '</tbody></table></div>');
        });
      } else {
        var byInd = {};
        J.cells.forEach(function (c) { (byInd[c.iid] = byInd[c.iid] || []).push(c); });
        Object.keys(byInd).forEach(function (iid) {
          var ind = IND[iid], list = byInd[iid], periods = D.periods || [];
          parts.push('<div class="iq-print-row"><b>' + esc(ind.label || iid) + '（' + esc(ind.unit || "") + '，示例判据 ' + fx(ind.limit != null ? ind.limit : MODEL.limit, ind.decimals) + '）</b></div>');
          parts.push('<div class="iq-tw"><table class="iq-tb"><thead><tr><th>点位</th>' +
            periods.map(function (p) { return '<th>' + esc((opt("periods", p) || {}).name || p) + '</th>'; }).join("") + '</tr></thead><tbody>' +
            D.rows.map(function (row) {
              return '<tr><td>' + esc(row.name) + '</td>' + periods.map(function (p) {
                var c = null; list.forEach(function (x) { if (x.sid === row.id && x.pid === p) { c = x; } });
                return '<td>' + (c ? fx(c.v, ind.decimals) + ' ±' + fx(c.u, ind.decimals) + '　' + esc(c.label) : "—") + '</td>';
              }).join("") + '</tr>';
            }).join("") + '</tbody></table></div>');
        });
      }
      parts.push('<div class="iq-print-row"><b>数据总体表现：</b>' +
        ({ all: "全部关键项显示差异/超限", none: "未发现差异/超限", partial: "仅部分项显示差异/超限" }[J.outcome]) + '</div>');
    } else {
      parts.push('<div class="iq-print-h">三、数据与判定</div><div class="iq-print-row">（尚未生成数据）</div>');
    }

    parts.push('<div class="iq-print-h">四、结论与讨论</div>');
    parts.push('<div class="iq-print-row">' + (S.conclusion ? esc(S.conclusion).replace(/\n/g, "<br>") : "（未填）") + '</div>');

    parts.push('<div class="iq-print-h">五、探究等级与自评</div>');
    parts.push('<div class="iq-print-row"><b>探究等级 ' + esc(L.lvl.n) + ' · ' + esc(L.lvl.nm) + '</b>（' + L.score + ' / ' + L.max + ' 项自主）</div>');
    parts.push('<div class="iq-print-row">' + L.checks.map(function (c) { return (c.ok ? "☑ " : "☐ ") + esc(c.t); }).join("<br>") + '</div>');
    parts.push('<div class="iq-print-row"><b>报告量规：</b>' + RUB.map(function (r) { return (S.rub[r.id] ? "☑ " : "☐ ") + esc(r.t); }).join("<br>") + '</div>');
    parts.push('<div class="iq-note">本报告数据为教学模拟，限值与判据为教学示例，不构成法规限值引用或正式评价结论。</div>');
    return parts.join("");
  }

  /* ================= 10. 渲染与事件 ================= */
  function render() {
    if (!root) { return; }
    var v = S.step === 1 ? vStep1() : S.step === 2 ? vStep2() : S.step === 3 ? vStep3() : S.step === 4 ? vStep4() : vStep5();
    root.innerHTML = v;
    var cp = $("#iq-print");
    if (cp) { cp.innerHTML = S.step === 5 ? buildReport() : ""; }
    if (S.step === 1 && S.q === "__custom") {
      var t = $("#iqQCustom");
      if (t && document.activeElement !== t) { /* 不抢焦点 */ }
    }
  }

  function flash(msg) {
    var e = $(".iq-err", root);
    if (e) { e.innerHTML = msg; e.hidden = false; }
  }
  function clearFlash() { var e = $(".iq-err", root); if (e) { e.hidden = true; e.innerHTML = ""; } }

  /* 结论文本边写边更新量规的自动检出标记（不整页重绘，避免打断输入） */
  function refreshRubric() {
    RUB.forEach(function (r) {
      if (!r.auto) { return; }
      var el = root.querySelector('[data-auto="' + r.id + '"]');
      if (!el) { return; }
      var a = r.auto(S.conclusion || "");
      el.className = "auto " + (a ? "pass" : "fail");
      el.textContent = a ? "文本中已检出" : "文本中未检出";
    });
  }

  function pick(dimId, optId) {
    var d = dim(dimId); if (!d) { return; }
    var a = selOf(dimId), k = a.indexOf(optId), isMulti = d.multi !== false;
    if (isMulti) {
      if (k >= 0) { a.splice(k, 1); }
      else {
        if (d.max && a.length >= d.max) { flash("「" + esc(d.name) + "」最多选 " + d.max + " 项，先取消一个再选。"); return; }
        a.push(optId);
      }
    } else {
      S.sel[dimId] = (k >= 0) ? [] : [optId];
    }
    S.ran = false; S.data = null;
    save(); clearFlash(); render();
  }

  function go(n) {
    n = Number(n);
    if (n > maxReached()) { return; }
    S.step = n; save(); render();
    var top = root.getBoundingClientRect().top + window.pageYOffset - 20;
    window.scrollTo(0, Math.max(0, top));
  }

  function next() {
    if (S.step === 1) {
      if (!S.q) { flash("先选一个驱动问题（或选「我自己提一个问题」）。"); return; }
      if (S.q === "__custom" && (S.qCustom || "").trim().length < 6) { flash("你选了自拟问题，请把问题写下来（至少 6 个字）。"); return; }
      if ((S.hypo || "").trim().length < 8) { flash("请写下你的预判（至少 8 个字）。先猜再验，是探究和照做的分水岭。"); return; }
    }
    if (S.step === 2) {
      if (overBudget()) { flash("预算超支，请先砍掉一些项目。"); return; }
      if (selIndicatorIds().length === 0) { flash("至少选 1 个监测指标。"); return; }
      if (selSiteIds().length === 0) { flash("至少选 1 个点位。"); return; }
      var d = dim(cfg.replicateDim || "freq");
      if (d && !one(d.id)) { flash("请选择每点位的重复次数（选 1 次也算，但你就没有不确定度了）。"); return; }
    }
    if (S.step === 3) {
      if (!S.expect) { flash("请先选一个预期方向。"); return; }
      if ((S.criterion || "").trim().length < 10) { flash("请写清判定标准（至少 10 个字）。这一步是为了防止事后改判据。"); return; }
    }
    if (S.step === 4) {
      if (!S.ran) { flash("请先生成模拟数据。"); return; }
    }
    S.step = Math.min(5, S.step + 1); save(); render();
    var top = root.getBoundingClientRect().top + window.pageYOffset - 20;
    window.scrollTo(0, Math.max(0, top));
  }

  function run() {
    S.data = gen();
    S.ran = true;
    S.stamp = Date.now();
    save(); clearFlash(); render();
  }

  /* 事件委托：所有交互都通过 data-act 走同一条路径 */
  function bind() {
    root.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || !root.contains(t)) { return; }
      var act = t.getAttribute("data-act");
      if (act === "pick") { pick(t.getAttribute("data-dim"), t.getAttribute("data-opt")); }
      else if (act === "pickQ") {
        var o = t.getAttribute("data-opt");
        S.q = (S.q === o) ? null : o;
        S.ran = false; S.data = null; save(); clearFlash(); render();
      }
      else if (act === "pickE") {
        var eo = t.getAttribute("data-opt");
        S.expect = (S.expect === eo) ? null : eo;
        save(); clearFlash(); render();
      }
      else if (act === "go") { go(t.getAttribute("data-step")); }
      else if (act === "next") { next(); }
      else if (act === "run") { run(); }
      else if (act === "print") { window.print(); }
      else if (act === "reset") {
        if (window.confirm("确定重置本次探究？所有选择、数据与结论都会清空。")) {
          S = blank(); save(); render();
        }
      }
      else if (act === "rub") { /* 由 change 处理，避免双触发 */ }
    });

    root.addEventListener("input", function (e) {
      var f = e.target.getAttribute && e.target.getAttribute("data-field");
      if (!f) { return; }
      S[f] = e.target.value;
      if (f === "qCustom" || f === "hypo" || f === "criterion") { S.ran = false; S.data = null; }
      var c = root.querySelector('[data-count="' + f + '"]');
      if (c) { c.textContent = String(S[f].length); }
      if (f === "conclusion") { refreshRubric(); }
      save();
    });

    root.addEventListener("change", function (e) {
      var t = e.target;
      if (t.getAttribute && t.getAttribute("data-act") === "rub") {
        S.rub[t.getAttribute("data-opt")] = !!t.checked;
        save();
      }
    });

    /* 切换问题后显示/隐藏自拟输入框 */
    root.addEventListener("click", function (e) {
      var w = $("#iqCustomWrap");
      if (w) { w.hidden = (S.q !== "__custom"); }
    }, true);
  }

  /* ================= 11. 启动 ================= */
  function boot() {
    root = $("#inq");
    if (!root) { return; }
    bind();
    render();

    /* 阅读进度条 + 分区入场（与全站一致的观感） */
    var sp = $("#sp");
    if (sp) {
      window.addEventListener("scroll", function () {
        var h = document.documentElement;
        var max = h.scrollHeight - h.clientHeight;
        sp.style.width = (max > 0 ? (h.scrollTop / max * 100) : 0) + "%";
      }, { passive: true });
    }
    var secs = document.querySelectorAll(".sec");
    if (secs.length && typeof IntersectionObserver === "function") {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("visible"); } });
      }, { threshold: 0.1 });
      Array.prototype.forEach.call(secs, function (s) { io.observe(s); });
    } else {
      Array.prototype.forEach.call(secs, function (s) { s.classList.add("visible"); });
    }
    /* 返回按钮 */
    var bk = $("#bk");
    if (bk) {
      var f = function () {
        var y = window.pageYOffset || document.documentElement.scrollTop;
        if (y > 260) { bk.classList.add("on"); } else { bk.classList.remove("on"); }
      };
      window.addEventListener("scroll", f, { passive: true }); f();
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && e.altKey) { window.location.href = bk.getAttribute("href"); }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
