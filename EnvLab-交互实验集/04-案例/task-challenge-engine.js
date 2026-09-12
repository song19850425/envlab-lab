(function(){
  "use strict";
  var challenge=window.EnvLabChallenge;
  if(!challenge||!challenge.steps||!challenge.steps.length){return;}
  var HISTORY_KEY="envlab.task."+challenge.key+".v1";
  var letters=["A","B","C","D"];
  var state={current:0,attempts:{},mistakes:[],mode:"run",reviewQueue:[],locked:false,record:null,reviewDone:false};
  var app=document.getElementById("app");
  var rail=document.getElementById("railList");

  function esc(v){
    var map={"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"};
    return String(v==null?"":v).replace(/[&<>"']/g,function(c){return map[c];});
  }
  function safeHref(v){
    var s=String(v||"");
    return /^[A-Za-z0-9_\u4e00-\u9fff./?=&%#\-]+$/.test(s)?esc(s):"#";
  }
  function readHistory(){
    try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||"[]")||[];}catch(e){return [];}
  }
  function saveHistory(record){
    try{
      var items=readHistory();
      items.push(record);
      localStorage.setItem(HISTORY_KEY,JSON.stringify(items.slice(-20)));
      return items.length;
    }catch(e){return 0;}
  }
  function announce(text){
    var node=document.getElementById("announce");
    if(node)node.textContent=text;
  }
  function renderHeader(){
    document.title=challenge.title+" | EnvLab";
    document.documentElement.style.setProperty("--accent",challenge.accent||"#38bdf8");
    document.documentElement.style.setProperty("--accent-soft",challenge.accentSoft||"rgba(56,189,248,.12)");
    var kicker=document.getElementById("challengeKicker");
    var title=document.getElementById("challengeTitle");
    var intro=document.getElementById("challengeIntro");
    var badges=document.getElementById("challengeBadges");
    var notice=document.getElementById("noticeText");
    if(kicker)kicker.textContent=challenge.kicker;
    if(title)title.textContent=challenge.title;
    if(intro)intro.textContent=challenge.intro;
    if(notice)notice.textContent=challenge.disclaimer;
    if(badges)badges.innerHTML=(challenge.badges||[]).map(function(x){return "<span>"+esc(x)+"</span>";}).join("");
  }
  function renderRelated(){
    var box=document.getElementById("relatedLinks");
    if(!box)return;
    box.innerHTML=(challenge.related||[]).map(function(x){return '<a href="'+safeHref(x.href)+'"><b>'+esc(x.name)+'</b><span>'+esc(x.note)+'</span></a>';}).join("");
  }
  function renderRail(){
    if(!rail)return;
    rail.innerHTML=challenge.steps.map(function(s,i){
      var cls="";
      if(state.mode==="run"&&i===state.current)cls="active";
      if(state.mode==="review"&&state.reviewQueue.length&&i===state.reviewQueue[0])cls="active";
      if(state.mode==="run"&&i<state.current)cls="done";
      if(state.mode==="review"&&state.reviewDone)cls="done";
      return '<li class="'+cls+'"><span class="num">'+(i+1)+'</span><span>'+esc(s.short)+'</span></li>';
    }).join("");
  }
  function evidenceHtml(step){
    return '<div class="evidence"><div class="evidence-title">现场证据与当前状态</div><div class="evidence-grid">'+step.evidence.map(function(row){return '<div class="evidence-item"><b>'+esc(row[0])+'</b><span>'+esc(row[1])+'</span></div>';}).join("")+'</div></div>';
  }
  function feedbackHtml(kind,title,body,impact){
    return '<div class="feedback '+kind+'" role="'+(kind==="bad"?"alert":"status")+'"><div class="fb-title">'+esc(title)+'</div><div>'+esc(body)+'</div><div class="impact">'+esc(impact)+'</div></div>';
  }
  function renderIntro(){
    renderRail();
    var focus=(challenge.focus||[]).map(function(x){return '<div class="evidence-item"><b>'+esc(x[0])+'</b><span>'+esc(x[1])+'</span></div>';}).join("");
    app.innerHTML='<article class="card task-card">'+
      '<div id="announce" class="sr-only" aria-live="polite"></div>'+ 
      '<div class="task-meta"><span class="pill green">建议先做主任务</span><span class="pill">约 '+esc(challenge.duration||"8 分钟")+'</span><span class="pill">无需登录</span></div>'+ 
      '<h2 class="step-title">'+esc(challenge.caseTitle||challenge.title)+'</h2>'+ 
      '<p class="step-intro">'+esc(challenge.caseIntro||challenge.intro)+'</p>'+ 
      '<div class="evidence"><div class="evidence-title">本次训练看什么</div><div class="evidence-grid">'+focus+'</div></div>'+ 
      '<div class="notice" style="margin:0"><div class="notice-title">开始前提示</div><div>'+esc(challenge.startNote||"先看证据，再决定下一步；答错会说明后果并进入针对性复训。")+'</div></div>'+ 
      '<div class="btn-row"><button class="btn green" id="startBtn" type="button">开始完整任务</button><button class="btn secondary" id="lastBtn" type="button">查看练习记录</button></div>'+ 
      '<div id="historyBox" hidden></div>'+ 
      '</article>';
    document.getElementById("startBtn").addEventListener("click",function(){startRun();});
    document.getElementById("lastBtn").addEventListener("click",function(){toggleHistory();});
  }
  function stepIndex(){return state.mode==="review"?state.reviewQueue[0]:state.current;}
  function renderStep(){
    var idx=stepIndex(),step=challenge.steps[idx];
    if(!step){renderResult(false);return;}
    state.locked=false;
    renderRail();
    var completed=state.mode==="review"?challenge.steps.length-state.reviewQueue.length:state.current;
    var pct=Math.round(completed/challenge.steps.length*100);
    var reviewLabel=state.mode==="review"?'<span class="pill amber">针对性复训</span>':'<span class="pill green">主任务</span>';
    app.innerHTML='<article class="card task-card">'+
      '<div id="announce" class="sr-only" aria-live="polite"></div>'+ 
      '<div class="task-meta"><span class="pill">第 '+(idx+1)+' / '+challenge.steps.length+' 步</span>'+reviewLabel+'<span class="pill">能力点：'+esc(step.skill)+'</span></div>'+ 
      '<div class="progress-wrap"><div class="progress-line" role="progressbar" aria-valuemin="0" aria-valuemax="'+challenge.steps.length+'" aria-valuenow="'+(idx+1)+'" aria-label="任务进度"><i style="width:'+Math.max(8,pct)+'%"></i></div><div class="progress-text"><span>'+esc(state.mode==="review"?"按错题重新判断":"完整任务链")+'</span><span>'+pct+'% 已完成</span></div></div>'+ 
      '<h2 class="step-title" tabindex="-1" id="stepHeading">'+esc(step.title)+'</h2>'+ 
      '<p class="step-intro">'+esc(step.intro)+'</p>'+evidenceHtml(step)+
      '<h3 class="question">'+esc(step.question)+'</h3>'+ 
      '<div class="choices" role="group" aria-label="选择你的处理方式">'+step.options.map(function(o,i){return '<button class="choice" type="button" data-option="'+i+'"><span class="letter">'+letters[i]+'</span><span class="choice-text">'+esc(o.text)+'</span></button>';}).join("")+'</div>'+ 
      '<div id="feedback" hidden></div>'+ 
      '<div class="btn-row"><button class="btn secondary" id="quitBtn" type="button">返回任务说明</button></div>'+ 
      '</article>';
    var heading=document.getElementById("stepHeading");
    if(heading){if(window.requestAnimationFrame)window.requestAnimationFrame(function(){heading.focus();});else heading.focus();}
    document.querySelectorAll(".choice").forEach(function(button){button.addEventListener("click",function(){choose(idx,Number(button.dataset.option),button);});});
    document.getElementById("quitBtn").addEventListener("click",function(){renderIntro();});
    announce("现在是第 "+(idx+1)+" 步："+step.title);
  }
  function choose(idx,optIndex,button){
    if(state.locked)return;
    var step=challenge.steps[idx],option=step.options[optIndex];
    state.attempts[idx]=(state.attempts[idx]||0)+1;
    state.locked=true;
    document.querySelectorAll(".choice").forEach(function(b){b.disabled=true;});
    button.classList.add(option.correct?"correct":"wrong");
    var feedback=document.getElementById("feedback");
    feedback.hidden=false;
    feedback.innerHTML=feedbackHtml(option.correct?"good":"bad",option.correct?"判断成立":"先停一下",option.feedback,option.impact);
    if(!option.correct){
      if(state.mistakes.indexOf(idx)<0)state.mistakes.push(idx);
      document.querySelectorAll(".choice").forEach(function(b){if(b!==button)b.disabled=false;});
      state.locked=false;
      announce("这一步需要修正："+step.skill);
      return;
    }
    document.querySelectorAll(".choice").forEach(function(b){if(b!==button)b.classList.add("dim");});
    announce("判断正确，进入下一步");
    window.setTimeout(function(){
      if(state.mode==="review"){
        state.reviewQueue.shift();
        if(!state.reviewQueue.length){state.reviewDone=true;renderResult(true);}else{renderStep();}
      }else{
        state.current++;
        if(state.current>=challenge.steps.length){finish();}else{renderStep();}
      }
    },620);
  }
  function resetRun(){state={current:0,attempts:{},mistakes:[],mode:"run",reviewQueue:[],locked:false,record:null,reviewDone:false};}
  function startRun(){resetRun();renderStep();}
  function finish(){
    var firstTry=challenge.steps.filter(function(_,i){return state.attempts[i]===1;}).length;
    var score=Math.round(firstTry/challenge.steps.length*100);
    var record={ts:new Date().toISOString(),challenge:challenge.key,score:score,firstTry:firstTry,total:challenge.steps.length,mistakes:state.mistakes.slice(),skills:state.mistakes.map(function(i){return challenge.steps[i].skill;})};
    state.record=record;
    record.historyCount=saveHistory(record);
    renderResult(false);
  }
  function renderResult(reviewFinished){
    renderRail();
    var r=state.record,wrong=state.mistakes.slice().sort(function(a,b){return a-b;}),pass=r.score>=80;
    var reviewHtml=wrong.length?wrong.map(function(idx){var s=challenge.steps[idx];return '<div class="review-item"><div><b>第 '+(idx+1)+' 步 · '+esc(s.title)+'</b><span>能力点：'+esc(s.skill)+' · '+(state.attempts[idx]||0)+' 次尝试</span></div><button class="mini-btn" type="button" data-review="'+idx+'">复训这一项</button></div>';}).join(""):'<div class="result-notice">本次没有错题，说明你已经把 '+challenge.steps.length+' 个判断点完整走通。可以打开关联页面，把其中一个环节做深。</div>';
    app.innerHTML='<article class="card result-card">'+
      '<div id="announce" class="sr-only" aria-live="polite"></div>'+ 
      '<div class="result-top"><div class="score">'+r.score+'<small>/100</small></div><div><div class="result-state">'+(pass?"任务链路已走通":"任务完成，但建议继续复训")+'</div><div class="result-sub">首选正确 '+r.firstTry+' / '+r.total+' · 错题 '+wrong.length+' 项 · 只作本机练习记录</div></div></div>'+ 
      (reviewFinished?'<div class="result-notice">针对性复训已完成。现在回到结果页，你可以再做一遍主任务或打开对应页面。</div>':'')+
      '<h2 class="section-title">错题复训</h2><div class="review-grid">'+reviewHtml+'</div>'+ 
      '<div class="btn-row">'+(wrong.length?'<button class="btn green" id="reviewAll" type="button">按错题顺序复训</button>':'')+'<button class="btn" id="retryAll" type="button">再做一遍完整任务</button><button class="btn secondary" id="resultIntro" type="button">返回任务说明</button></div>'+ 
      '<div class="result-notice" style="margin-top:18px;margin-bottom:0">记录仅保存在当前浏览器。它用于观察自己的练习轨迹，不构成正式培训证明或能力授权。</div>'+ 
      '</article>';
    document.querySelectorAll("[data-review]").forEach(function(b){b.addEventListener("click",function(){startReview([Number(b.dataset.review)]);});});
    var reviewAll=document.getElementById("reviewAll");
    if(reviewAll)reviewAll.addEventListener("click",function(){startReview(wrong);});
    document.getElementById("retryAll").addEventListener("click",function(){startRun();});
    document.getElementById("resultIntro").addEventListener("click",function(){renderIntro();});
    announce(reviewFinished?"针对性复训完成":"任务完成，结果已生成");
  }
  function startReview(indices){state.mode="review";state.reviewQueue=indices.slice();state.locked=false;renderStep();}
  function toggleHistory(){
    var box=document.getElementById("historyBox");
    if(!box)return;
    if(!box.hidden){box.hidden=true;return;}
    var items=readHistory();
    box.hidden=false;
    box.innerHTML=items.length?'<div class="evidence" style="margin-top:16px;margin-bottom:0"><div class="evidence-title">本机练习记录（最近 '+items.length+' 次）</div><div class="evidence-grid">'+items.slice().reverse().slice(0,6).map(function(x){return '<div class="evidence-item"><b>'+new Date(x.ts).toLocaleString("zh-CN")+'</b><span>首选正确 '+esc(x.firstTry)+" / "+esc(x.total)+" · 得分 "+esc(x.score)+" · 错题 "+esc(x.mistakes.length)+" 项</span></div>";}).join("")+'</div></div>':'<div class="evidence" style="margin-top:16px;margin-bottom:0"><div class="evidence-title">还没有练习记录</div><div class="evidence-item"><span>完成一次任务后，这里会显示最近的本机练习轨迹。</span></div></div>';
  }
  renderHeader();
  renderRelated();
  renderIntro();
})();
