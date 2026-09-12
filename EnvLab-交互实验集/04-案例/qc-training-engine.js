(function(){
  "use strict";
  var cfg=window.EnvLabQC;
  if(!cfg)return;
  var state={mode:null,queue:[],pos:0,review:false,attempts:{},reviewAttempts:{},mistakes:[],reviewMistakes:[],locked:false,record:null,reviewCorrect:0};
  var rail=document.getElementById("railList");
  var app=document.getElementById("app");
  function esc(v){var m={"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"};return String(v==null?"":v).replace(/[&<>"']/g,function(c){return m[c];});}
  function safeHref(v){var s=String(v||"");return /^[A-Za-z0-9_\u4e00-\u9fff./?=&%#\-]+$/.test(s)?esc(s):"#";}
  function history(){try{return JSON.parse(localStorage.getItem(cfg.historyKey)||"[]")||[];}catch(e){return [];}}
  function save(record){try{var a=history();a.push(record);localStorage.setItem(cfg.historyKey,JSON.stringify(a.slice(-20)));return a.length;}catch(e){return 0;}}
  function announce(t){var n=document.getElementById("announce");if(n)n.textContent=t;}
  function casesFor(mode){return mode==="qc"?cfg.qcCases:cfg.recordCases;}
  function currentCases(){return casesFor(state.mode);}
  function currentIndex(){return state.queue.length?state.queue[state.pos]:null;}
  function attemptMap(){return state.review?state.reviewAttempts:state.attempts;}
  function mistakeList(){return state.review?state.reviewMistakes:state.mistakes;}

  function renderHeader(){
    document.title=cfg.title+" | EnvLab";
    document.getElementById("challengeKicker").textContent=cfg.kicker;
    document.getElementById("challengeTitle").textContent=cfg.title;
    document.getElementById("challengeIntro").textContent=cfg.intro;
    document.getElementById("noticeText").textContent=cfg.disclaimer;
    document.getElementById("challengeBadges").innerHTML=(cfg.badges||[]).map(function(x){return "<span>"+esc(x)+"</span>";}).join("");
  }
  function renderRelated(){
    document.getElementById("relatedLinks").innerHTML=(cfg.related||[]).map(function(x){return '<a href="'+safeHref(x.href)+'"><b>'+esc(x.name)+'</b><span>'+esc(x.note)+'</span></a>';}).join("");
  }
  function renderRail(){
    var cases=currentCases();
    rail.innerHTML=state.queue.map(function(ci,i){
      var cls="";
      if(i===state.pos)cls="active";
      else if(i<state.pos)cls="done";
      return '<li class="'+cls+'"><span class="num">'+(i+1)+'</span><span>'+esc(cases[ci].short)+'</span></li>';
    }).join("");
  }
  function feedback(kind,title,body,impact){
    return '<div class="feedback '+kind+'" role="'+(kind==="bad"?"alert":"status")+'"><div class="fb-title">'+esc(title)+'</div><div>'+esc(body)+'</div><div class="impact">'+esc(impact)+'</div></div>';
  }

  function renderIntro(){
    state.mode=null;state.queue=[];state.pos=0;state.review=false;state.locked=false;state.record=null;
    rail.innerHTML="";
    app.innerHTML='<article class="card task-card"><div id="announce" class="sr-only" aria-live="polite"></div>'
      +'<div class="task-meta"><span class="pill green">质量控制训练</span><span class="pill">两个训练模式</span><span class="pill">无需登录</span></div>'
      +'<h2 class="step-title">把“数据看起来正常”变成“证据支持可用”</h2>'
      +'<p class="step-intro">这里不要求你背某一个项目的固定限值，而是训练发现异常、保留原始记录、选择验证动作和表达数据边界。</p>'
      +'<div class="mode-grid">'
      +'<button class="mode-card" id="qcMode" type="button"><b>质控证据判定</b><span>空白、平行、加标、校准核查等证据出现异常时，判断能否进入结果解释。</span><small>'+(cfg.qcCases||[]).length+' 个案例 · 单选判断</small></button>'
      +'<button class="mode-card" id="recordMode" type="button"><b>原始记录找错</b><span>从样品编号、时间顺序、单位、稀释倍数和质控记录中找出会影响追溯的错误。</span><small>'+(cfg.recordCases||[]).length+' 个案例 · 逐项勾选</small></button>'
      +'</div>'
      +'<div class="notice" style="margin:18px 0 0"><div class="notice-title">使用边界</div><div>所有判据都是教学场景中的示例。正式判定应回到适用的现行方法、项目操作规程和实验室质量体系。</div></div>'
      +'<div class="btn-row"><button class="btn secondary" id="historyBtn" type="button">查看本机练习记录</button></div>'
      +'<div id="historyBox" hidden></div></article>';
    document.getElementById("qcMode").addEventListener("click",function(){start("qc");});
    document.getElementById("recordMode").addEventListener("click",function(){start("record");});
    document.getElementById("historyBtn").addEventListener("click",toggleHistory);
  }

  function start(mode){
    state.mode=mode;state.review=false;state.locked=false;state.record=null;
    state.attempts={};state.mistakes=[];state.reviewAttempts={};state.reviewMistakes=[];state.reviewCorrect=0;
    state.queue=currentCases().map(function(_,i){return i;});
    state.pos=0;
    renderCase();
  }
  function startReview(indices){
    if(!indices||!indices.length)return;
    state.review=true;state.locked=false;
    state.reviewAttempts={};state.reviewMistakes=[];state.reviewCorrect=0;
    state.queue=indices.slice();state.pos=0;
    renderCase();
  }

  function renderEvidence(c){
    return '<div class="evidence"><div class="evidence-title">案例证据</div><div class="evidence-grid">'
      +c.evidence.map(function(r){return '<div class="evidence-item"><b>'+esc(r[0])+'</b><span>'+esc(r[1])+'</span></div>';}).join("")
      +'</div></div>';
  }

  function renderCase(){
    var cases=currentCases(),idx=currentIndex();
    if(idx===null||idx===undefined){if(state.review)renderReviewEnd();else finish();return;}
    var c=cases[idx];
    state.locked=false;
    renderRail();
    var total=state.queue.length,pos=state.pos;
    var pct=Math.round(pos/total*100);
    var label=state.review?("复训 · "+cfg.modeLabels[state.mode]):cfg.modeLabels[state.mode];
    var body=state.mode==="qc"?renderQC(c):renderRecord(c);
    app.innerHTML='<article class="card task-card"><div id="announce" class="sr-only" aria-live="polite"></div>'
      +'<div class="task-meta"><span class="pill">第 '+(pos+1)+' / '+total+' 题</span>'
      +'<span class="pill '+(state.mode==="qc"?"green":"amber")+'">'+esc(label)+'</span>'
      +'<span class="pill">能力点：'+esc(c.skill)+'</span></div>'
      +'<div class="progress-wrap"><div class="progress-line" role="progressbar" aria-valuemin="0" aria-valuemax="'+total+'" aria-valuenow="'+(pos+1)+'" aria-label="训练进度"><i style="width:'+Math.max(8,pct)+'%"></i></div>'
      +'<div class="progress-text"><span>'+esc(label)+'</span><span>'+pct+'% 已完成</span></div></div>'
      +'<h2 class="step-title" tabindex="-1" id="stepHeading">'+esc(c.title)+'</h2>'
      +'<p class="step-intro">'+esc(c.intro)+'</p>'
      +renderEvidence(c)+body
      +'<div class="btn-row"><button class="btn secondary" id="backBtn" type="button">返回训练模式</button></div></article>';
    var h=document.getElementById("stepHeading");
    if(h){if(window.requestAnimationFrame)window.requestAnimationFrame(function(){h.focus();});else h.focus();}
    document.getElementById("backBtn").addEventListener("click",renderIntro);
    if(state.mode==="qc"){
      document.querySelectorAll(".choice").forEach(function(b){
        b.addEventListener("click",function(){chooseQC(c,idx,Number(b.dataset.i),b);});
      });
    }else{
      document.getElementById("recordSubmit").addEventListener("click",function(){submitRecord(c,idx);});
    }
    announce("第 "+(pos+1)+" 题："+c.title);
  }

  function renderQC(c){
    return '<h3 class="question">'+esc(c.question)+'</h3><div class="choices" role="group" aria-label="选择判定">'
      +c.options.map(function(o,i){return '<button class="choice" type="button" data-i="'+i+'"><span class="letter">'+String.fromCharCode(65+i)+'</span><span class="choice-text">'+esc(o.text)+'</span></button>';}).join("")
      +'</div><div id="feedback" hidden></div>';
  }
  function renderRecord(c){
    return '<h3 class="question">'+esc(c.question)+'</h3><div class="record-list" role="group" aria-label="选择疑似错误记录">'
      +c.rows.map(function(r,i){return '<label class="record-row"><input type="checkbox" value="'+i+'"><span class="record-index">'+(i+1)+'</span><span><b>'+esc(r[0])+'</b><small>'+esc(r[1])+'</small></span></label>';}).join("")
      +'</div><div id="feedback" hidden></div><div class="record-actions"><button class="btn green" id="recordSubmit" type="button">提交找错结果</button><button class="btn secondary" id="recordRetry" type="button" hidden>再次检查</button><button class="btn secondary" id="recordContinue" type="button" hidden>继续下一题</button></div>';
  }

  function chooseQC(c,idx,i,b){
    if(state.locked)return;
    var o=c.options[i];
    var a=attemptMap();
    a[idx]=(a[idx]||0)+1;
    state.locked=true;
    document.querySelectorAll(".choice").forEach(function(x){x.disabled=true;});
    b.classList.add(o.correct?"correct":"wrong");
    var f=document.getElementById("feedback");
    f.hidden=false;
    f.innerHTML=feedback(o.correct?"good":"bad",o.correct?"判断成立":"先停一下",o.feedback,o.impact);
    if(o.correct){
      document.querySelectorAll(".choice").forEach(function(x){if(x!==b)x.classList.add("dim");});
      if(state.review&&a[idx]===1)state.reviewCorrect++;
      announce("判断成立："+c.skill);
      setTimeout(advance,620);
      return;
    }
    var ml=mistakeList();
    if(ml.indexOf(idx)<0)ml.push(idx);
    document.querySelectorAll(".choice").forEach(function(x){if(x!==b)x.disabled=false;});
    state.locked=false;
    announce("质控判定需要修正："+c.skill);
  }

  function submitRecord(c,idx){
    if(state.locked)return;
    var selected=[];
    document.querySelectorAll(".record-row input:checked").forEach(function(x){selected.push(Number(x.value));});
    selected.sort(function(a,b){return a-b;});
    var expected=c.errors.slice().sort(function(a,b){return a-b;});
    var same=selected.length===expected.length&&selected.every(function(x,i){return x===expected[i];});
    var a=attemptMap();
    a[idx]=(a[idx]||0)+1;
    var f=document.getElementById("feedback");
    f.hidden=false;
    if(same){
      state.locked=true;
      f.innerHTML=feedback("good","找对了","你标记的记录与本题教学答案一致。","先定位错误，再回到原始记录核对，是质量控制的基本动作。");
      document.getElementById("recordSubmit").disabled=true;
      if(state.review&&a[idx]===1)state.reviewCorrect++;
      announce("找对了："+c.skill);
      setTimeout(advance,620);
      return;
    }
    var ml=mistakeList();
    if(ml.indexOf(idx)<0)ml.push(idx);
    var missed=expected.filter(function(x){return selected.indexOf(x)<0;}).map(function(x){return "第"+(x+1)+"行";});
    var extra=selected.filter(function(x){return expected.indexOf(x)<0;}).map(function(x){return "第"+(x+1)+"行";});
    var text=(missed.length?"漏掉 "+missed.join("、")+"。":"")+(extra.length?"多选 "+extra.join("、")+"。":"");
    f.innerHTML=feedback("bad","还需要再看一遍",text+"请区分真正影响身份、时间、单位、计算或质控状态的记录。","错误答案会被记入复训，但你可以在继续前再次检查。");
    var submit=document.getElementById("recordSubmit");
    var retry=document.getElementById("recordRetry");
    var cont=document.getElementById("recordContinue");
    submit.hidden=true;
    retry.hidden=false;
    cont.hidden=false;
    retry.onclick=function(){f.hidden=true;submit.hidden=false;retry.hidden=true;cont.hidden=true;};
    cont.onclick=advance;
    announce("原始记录核对需要修正："+c.skill);
  }

  function advance(){state.pos++;renderCase();}

  function finish(){
    var cases=currentCases(),total=state.queue.length;
    var first=state.queue.filter(function(ci){return state.attempts[ci]===1;}).length;
    var score=total?Math.round(first/total*100):0;
    state.record={ts:new Date().toISOString(),mode:state.mode,score:score,firstTry:first,total:total,mistakes:state.mistakes.slice(),skills:state.mistakes.map(function(i){return cases[i].skill;})};
    state.record.historyCount=save(state.record);
    renderResult();
  }

  function renderResult(){
    renderRail();
    var cases=currentCases(),r=state.record;
    if(!r){renderIntro();return;}
    var wrong=r.mistakes.slice().sort(function(a,b){return a-b;});
    var items=wrong.length?wrong.map(function(i){
      return '<div class="review-item"><div><b>第 '+(i+1)+' 题 · '+esc(cases[i].title)+'</b><span>能力点：'+esc(cases[i].skill)+' · '+(state.attempts[i]||0)+' 次尝试</span></div><button class="mini-btn" data-retry="'+i+'" type="button">复训这一题</button></div>';
    }).join(""):'<div class="result-notice">本次没有错题，说明你已经把本模式的证据判断完整走通。</div>';
    app.innerHTML='<article class="card result-card"><div id="announce" class="sr-only" aria-live="polite"></div>'
      +'<div class="result-top"><div class="score">'+r.score+'<small>/100</small></div><div><div class="result-state">'+(r.score>=80?"训练链路已走通":"训练完成，但建议继续复训")+'</div><div class="result-sub">首选正确 '+r.firstTry+' / '+r.total+' · 错题 '+wrong.length+' 项 · '+esc(cfg.modeLabels[r.mode])+'</div></div></div>'
      +'<h2 class="section-title">错题复训</h2><div class="review-grid">'+items+'</div>'
      +'<div class="btn-row">'+(wrong.length?'<button class="btn green" id="retryAll" type="button">按错题顺序复训</button>':'')
      +'<button class="btn" id="againBtn" type="button">再做一遍本模式</button>'
      +'<button class="btn secondary" id="homeBtn" type="button">返回训练模式</button></div>'
      +'<div class="result-notice" style="margin-top:18px;margin-bottom:0">记录仅保存在当前浏览器，用于练习轨迹，不构成正式培训证明或能力授权。</div></article>';
    document.querySelectorAll("[data-retry]").forEach(function(b){
      b.onclick=function(){startReview([Number(b.dataset.retry)]);};
    });
    var all=document.getElementById("retryAll");
    if(all)all.onclick=function(){startReview(wrong);};
    document.getElementById("againBtn").onclick=function(){start(r.mode);};
    document.getElementById("homeBtn").onclick=renderIntro;
    announce("训练完成，结果已生成");
  }

  function renderReviewEnd(){
    renderRail();
    var cases=currentCases(),total=state.queue.length;
    var items=state.queue.map(function(ci){
      var n=state.reviewAttempts[ci]||0;
      var ok=n===1;
      return '<div class="review-item" style="border-color:rgba(52,211,153,.28);background:rgba(52,211,153,.06)"><div><b>第 '+(ci+1)+' 题 · '+esc(cases[ci].title)+'</b><span>复训结果：'+(ok?"一次判断正确":"已重做，建议再练")+' · '+n+' 次尝试</span></div></div>';
    }).join("");
    app.innerHTML='<article class="card result-card"><div id="announce" class="sr-only" aria-live="polite"></div>'
      +'<div class="result-top"><div class="score">'+state.reviewCorrect+'<small>/'+total+'</small></div><div><div class="result-state">复训完成</div><div class="result-sub">一次判断正确 '+state.reviewCorrect+' / '+total+' · '+esc(cfg.modeLabels[state.mode])+'</div></div></div>'
      +'<h2 class="section-title">本次复训结果</h2><div class="review-grid">'+items+'</div>'
      +'<div class="btn-row"><button class="btn green" id="againBtn" type="button">再做一遍本模式</button><button class="btn" id="backResult" type="button">返回训练结果</button><button class="btn secondary" id="homeBtn" type="button">返回训练模式</button></div>'
      +'<div class="result-notice" style="margin-top:18px;margin-bottom:0">复训不会改写上一次的得分记录，只用于巩固薄弱能力点。</div></article>';
    document.getElementById("againBtn").onclick=function(){start(state.mode);};
    document.getElementById("backResult").onclick=renderResult;
    document.getElementById("homeBtn").onclick=renderIntro;
    announce("复训完成");
  }

  function toggleHistory(){
    var box=document.getElementById("historyBox");
    if(!box)return;
    if(!box.hidden){box.hidden=true;return;}
    var items=history();
    box.hidden=false;
    box.innerHTML=items.length
      ?'<div class="evidence" style="margin-top:16px;margin-bottom:0"><div class="evidence-title">本机练习记录（最近 '+items.length+' 次）</div><div class="evidence-grid">'+items.slice().reverse().slice(0,6).map(function(x){return '<div class="evidence-item"><b>'+esc(new Date(x.ts).toLocaleString("zh-CN"))+'</b><span>'+esc(cfg.modeLabels[x.mode])+' · 首选正确 '+esc(x.firstTry)+" / "+esc(x.total)+" · 得分 "+esc(x.score)+'</span></div>';}).join("")+'</div></div>'
      :'<div class="evidence" style="margin-top:16px;margin-bottom:0"><div class="evidence-title">还没有练习记录</div><div class="evidence-item"><span>完成一次训练后，这里会显示最近的本机练习轨迹。</span></div></div>';
  }

  renderHeader();
  renderRelated();
  renderIntro();
})();
