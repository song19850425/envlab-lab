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
    var qaHtml;
    if(step.interactive){
      qaHtml='<h3 class="question">'+esc(step.question)+'</h3>'+
        '<p class="pick-hint">'+esc(step.interactive.hint||"在图上点选你的方案（可多选），然后提交。")+ '</p>'+
        '<div class="map-wrap" id="mapWrap" role="group" aria-label="点选作答区">'+step.interactive.svg+'</div>'+
        '<div id="feedback" hidden></div>'+
        '<div class="btn-row"><button class="btn green" id="pickSubmit" type="button">'+esc(step.interactive.submit||"提交方案")+'</button><button class="btn secondary" id="pickReset" type="button">重选</button><button class="btn secondary" id="quitBtn" type="button">返回任务说明</button></div>';
    }else{
      qaHtml='<h3 class="question">'+esc(step.question)+'</h3>'+
        '<div class="choices" role="group" aria-label="选择你的处理方式">'+step.options.map(function(o,i){return '<button class="choice" type="button" data-option="'+i+'"><span class="letter">'+letters[i]+'</span><span class="choice-text">'+esc(o.text)+'</span></button>';}).join("")+'</div>'+
        '<div id="feedback" hidden></div>'+
        '<div class="btn-row"><button class="btn secondary" id="quitBtn" type="button">返回任务说明</button></div>';
    }
    app.innerHTML='<article class="card task-card">'+
      '<div id="announce" class="sr-only" aria-live="polite"></div>'+ 
      '<div class="task-meta"><span class="pill">第 '+(idx+1)+' / '+challenge.steps.length+' 步</span>'+reviewLabel+'<span class="pill">能力点：'+esc(step.skill)+'</span></div>'+ 
      '<div class="progress-wrap"><div class="progress-line" role="progressbar" aria-valuemin="0" aria-valuemax="'+challenge.steps.length+'" aria-valuenow="'+(idx+1)+'" aria-label="任务进度"><i style="width:'+Math.max(8,pct)+'%"></i></div><div class="progress-text"><span>'+esc(state.mode==="review"?"按错题重新判断":"完整任务链")+'</span><span>'+pct+'% 已完成</span></div></div>'+ 
      '<h2 class="step-title" tabindex="-1" id="stepHeading">'+esc(step.title)+'</h2>'+ 
      '<p class="step-intro">'+esc(step.intro)+'</p>'+evidenceHtml(step)+
      qaHtml+
      '</article>';
    var heading=document.getElementById("stepHeading");
    if(heading){if(window.requestAnimationFrame)window.requestAnimationFrame(function(){heading.focus();});else heading.focus();}
    if(step.interactive){bindInteractive(idx,step);}
    else{document.querySelectorAll(".choice").forEach(function(button){button.addEventListener("click",function(){choose(idx,Number(button.dataset.option),button);});});}
    document.getElementById("quitBtn").addEventListener("click",function(){renderIntro();});
    announce("现在是第 "+(idx+1)+" 步："+step.title);
  }
  function bindInteractive(idx,step){
    var im=step.interactive;
    var wrap=document.getElementById("mapWrap");
    var selected=[];
    function syncCount(){
      var btn=document.getElementById("pickSubmit");
      if(btn)btn.textContent=(im.submit||"提交方案")+(selected.length?"（已选 "+selected.length+" 项）":"");
    }
    wrap.addEventListener("click",function(e){
      if(state.locked)return;
      var t=e.target&&e.target.closest?e.target.closest("[data-pick]"):null;
      if(!t||!wrap.contains(t))return;
      var id=t.getAttribute("data-pick");
      var i=selected.indexOf(id);
      if(i>=0){selected.splice(i,1);t.classList.remove("picked");}
      else{selected.push(id);t.classList.add("picked");}
      syncCount();
    });
    document.getElementById("pickReset").addEventListener("click",function(){
      if(state.locked)return;
      selected=[];
      wrap.querySelectorAll(".picked").forEach(function(n){n.classList.remove("picked");});
      syncCount();
    });
    document.getElementById("pickSubmit").addEventListener("click",function(){
      if(state.locked)return;
      state.attempts[idx]=(state.attempts[idx]||0)+1;
      state.locked=true;
      var res=im.check(selected.slice())||{};
      resolveAnswer(idx,!!res.ok,res.ok?"判断成立":"先停一下",res.body||"",res.impact||"");
    });
    syncCount();
  }
  function resolveAnswer(idx,correct,title,body,impact){
    var feedback=document.getElementById("feedback");
    feedback.hidden=false;
    feedback.innerHTML=feedbackHtml(correct?"good":"bad",title,body,impact);
    if(!correct){
      if(state.mistakes.indexOf(idx)<0)state.mistakes.push(idx);
      state.locked=false;
      announce("这一步需要修正："+challenge.steps[idx].skill);
      return;
    }
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
  function choose(idx,optIndex,button){
    if(state.locked)return;
    var step=challenge.steps[idx],option=step.options[optIndex];
    state.attempts[idx]=(state.attempts[idx]||0)+1;
    state.locked=true;
    document.querySelectorAll(".choice").forEach(function(b){b.disabled=true;});
    button.classList.add(option.correct?"correct":"wrong");
    if(!option.correct){
      document.querySelectorAll(".choice").forEach(function(b){if(b!==button)b.disabled=false;});
    }else{
      document.querySelectorAll(".choice").forEach(function(b){if(b!==button)b.classList.add("dim");});
    }
    resolveAnswer(idx,option.correct,option.correct?"判断成立":"先停一下",option.feedback,option.impact);
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
  function skillBadges(){
    return challenge.steps.map(function(s,i){
      var miss=state.mistakes.indexOf(i)>=0;
      return '<span class="skill-badge '+(miss?"miss":"ok")+'"><i>'+(miss?"\u2715":"\u2713")+'</i>'+esc(s.skill)+'</span>';
    }).join("");
  }
  function scorecardText(){
    var r=state.record;
    return [challenge.title+"｜EnvLab 任务挑战",
      "得分 "+r.score+"/100（首选正确 "+r.firstTry+"/"+r.total+"）",
      challenge.steps.map(function(s,i){return (state.mistakes.indexOf(i)>=0?"\u2715":"\u2713")+s.skill;}).join(" "),
      "教学练习记录，仅供自我检验"].join("\n");
  }
  function scorecardHtml(){
    return '<h2 class="section-title">能力画像</h2><div class="scorecard"><div class="skill-badges">'+skillBadges()+'</div>'+
      '<div class="btn-row" style="margin-top:12px"><button class="btn secondary" id="copyCard" type="button">复制成绩单</button></div></div>';
  }
  function ctaHtml(){
    var r=state.record,pass=r.score>=80;
    var cta=challenge.cta||{};
    if(pass){
      var h=cta.high||{};
      return '<div class="cta-box good"><div class="cta-title">'+esc(h.title||"这套判断链路可以直接用在项目上")+'</div>'+
        '<div class="cta-body">'+esc(h.body||"如果你正在做调查数字化、布点优化或数据质控工具，欢迎聊聊。")+'</div>'+
        '<div class="btn-row"><a class="btn green elmail" data-u="jinghao.song" data-d="gmail.com" href="#">'+esc(h.label||"联系作者聊聊")+'</a></div></div>';
    }
    var rec=null,i,sk;
    for(i=0;i<state.mistakes.length;i++){sk=challenge.steps[state.mistakes[i]].skill;if(challenge.skillLinks&&challenge.skillLinks[sk]){rec={skill:sk,href:challenge.skillLinks[sk]};break;}}
    if(rec){
      return '<div class="cta-box"><div class="cta-title">建议补学：'+esc(rec.skill)+'</div>'+
        '<div class="cta-body">这是本次的主要失分点，对应单项页可以把机理做深。</div>'+
        '<div class="btn-row"><a class="btn" href="'+safeHref(rec.href)+'">打开「'+esc(rec.skill)+'」单项页</a></div></div>';
    }
    return '<div class="cta-box"><div class="cta-title">建议继续复训</div><div class="cta-body">按上方错题复训，或打开页面下方的相关页面把环节做深。</div></div>';
  }
  function assembleMail(){
    document.querySelectorAll("a.elmail").forEach(function(a){
      var u=a.getAttribute("data-u"),d=a.getAttribute("data-d");
      if(!u||!d)return;
      var href=a.getAttribute("href");
      if(!href||href==="#")a.href="mailto:"+u+"@"+d;
    });
  }
  function renderResult(reviewFinished){
    renderRail();
    var r=state.record,wrong=state.mistakes.slice().sort(function(a,b){return a-b;}),pass=r.score>=80;
    var reviewHtml=wrong.length?wrong.map(function(idx){var s=challenge.steps[idx];return '<div class="review-item"><div><b>第 '+(idx+1)+' 步 · '+esc(s.title)+'</b><span>能力点：'+esc(s.skill)+' · '+(state.attempts[idx]||0)+' 次尝试</span></div><button class="mini-btn" type="button" data-review="'+idx+'">复训这一项</button></div>';}).join(""):'<div class="result-notice">本次没有错题，说明你已经把 '+challenge.steps.length+' 个判断点完整走通。可以打开关联页面，把其中一个环节做深。</div>';
    app.innerHTML='<article class="card result-card">'+
      '<div id="announce" class="sr-only" aria-live="polite"></div>'+ 
      '<div class="result-top"><div class="score">'+r.score+'<small>/100</small></div><div><div class="result-state">'+(pass?"任务链路已走通":"任务完成，但建议继续复训")+'</div><div class="result-sub">首选正确 '+r.firstTry+' / '+r.total+' · 错题 '+wrong.length+' 项 · 只作本机练习记录</div></div></div>'+ 
      (reviewFinished?'<div class="result-notice">针对性复训已完成。现在回到结果页，你可以再做一遍主任务或打开对应页面。</div>':'')+
      scorecardHtml()+
      ctaHtml()+
      '<h2 class="section-title">错题复训</h2><div class="review-grid">'+reviewHtml+'</div>'+ 
      '<div class="btn-row">'+(wrong.length?'<button class="btn green" id="reviewAll" type="button">按错题顺序复训</button>':'')+'<button class="btn" id="retryAll" type="button">再做一遍完整任务</button><button class="btn secondary" id="resultIntro" type="button">返回任务说明</button></div>'+ 
      '<div class="result-notice" style="margin-top:18px;margin-bottom:0">记录仅保存在当前浏览器。它用于观察自己的练习轨迹，不构成正式培训证明或能力授权。</div>'+ 
      '</article>';
    document.querySelectorAll("[data-review]").forEach(function(b){b.addEventListener("click",function(){startReview([Number(b.dataset.review)]);});});
    var reviewAll=document.getElementById("reviewAll");
    if(reviewAll)reviewAll.addEventListener("click",function(){startReview(wrong);});
    document.getElementById("retryAll").addEventListener("click",function(){startRun();});
    document.getElementById("resultIntro").addEventListener("click",function(){renderIntro();});
    var copyBtn=document.getElementById("copyCard");
    if(copyBtn)copyBtn.addEventListener("click",function(){
      var txt=scorecardText();
      function done(ok){copyBtn.textContent=ok?"已复制，去分享吧 ✓":"复制失败，请手动截图";window.setTimeout(function(){copyBtn.textContent="复制成绩单";},2200);}
      function fallback(){
        try{
          var ta=document.createElement("textarea");ta.value=txt;ta.style.position="fixed";ta.style.opacity="0";
          document.body.appendChild(ta);ta.select();
          var ok=document.execCommand("copy");document.body.removeChild(ta);done(!!ok);
        }catch(e){done(false);}
      }
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(function(){done(true);},function(){fallback();});}
      else fallback();
    });
    assembleMail();
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
