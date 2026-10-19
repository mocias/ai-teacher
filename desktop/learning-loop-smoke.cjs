const assert=require('node:assert/strict');
const http=require('node:http');
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');

// A deterministic local model exercises the real executor, tools, database and UI.
// It validates workflow plumbing, not the quality of an external teaching model.
exports.run=async(main,base)=>{
 const extended=process.argv.includes('--followup-smoke'),evidenceCount=extended?7:5;let followups;
 main.showInactive();
 const exec=code=>main.webContents.executeJavaScript(code).catch(e=>{throw Error(e.message+'\nWhile executing: '+code.slice(0,500));});
 const state=()=>exec(`fetch('/api/state').then(r=>r.json())`);
 const post=(path,body)=>exec(`fetch('/api/${path}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(async r=>{const x=await r.json();if(!r.ok)throw Error(x.error);return x;})`);
 const errors=[],calls=[];
 async function until(fn,label){const end=Date.now()+25000;while(Date.now()<end){if(errors.length)throw Error(errors.join('\n'));if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('等待超时：'+label+'\n'+await exec(`document.body.innerText.slice(-3500)`));}
 const click=async selector=>{await until(()=>exec(`!!document.querySelector(${JSON.stringify(selector)})`),selector);await exec(`document.querySelector(${JSON.stringify(selector)}).click()`);};
 const set=(selector,value)=>exec(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)};document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('input',{bubbles:true}))`);
 const submit=()=>exec(`document.querySelector('#dialog-form').requestSubmit(document.querySelector('#dialog-form button[type=submit]'))`);
 const closeWait=()=>until(()=>exec(`!document.querySelector('#editor').open`),'对话框保存关闭');
 const capture=async name=>writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,name+'.png'),(await main.webContents.capturePage()).toPNG());
 const server=http.createServer((req,res)=>{let raw='';req.on('data',b=>raw+=b);req.on('end',()=>{try{
  const body=JSON.parse(raw),{task,context}=JSON.parse(body.messages[1].content),L=context.learning;
  const invoked=body.messages.flatMap(m=>m.tool_calls||[]).map(c=>c.function.name);
  for(const m of body.messages.filter(m=>m.role==='tool')){const out=JSON.parse(m.content);if(out.error)throw Error(out.error);}
  let tool,args;const choose=(name,a)=>{tool=name;args=a;};
  if(task.module==='material'){
   if(!invoked.includes('teacher_read_material'))choose('teacher_read_material',{content_id:task.content_id});
   else if(!invoked.includes('teacher_analyze_material'))choose('teacher_analyze_material',{content_id:task.content_id,status:'ANALYZED',summary:'材料介绍函数输入、返回值与组合，覆盖当前测试范围。'});
  }else if(task.module==='capabilities'&&!invoked.includes('teacher_propose_capabilities'))choose('teacher_propose_capabilities',{items:[{title:'解释与使用函数',kind:'CORE',requirements:[{node:'函数与组合',description:'能解释输入、返回值，并用两个函数组合完成一次计算'}]}]});
  else if(task.module==='roadmap'&&!invoked.includes('teacher_plan_learning')){
   const shared={requirement_ids:L.requirements.map(r=>r.id),resource_ids:context.resources.map(r=>r.id)};
   choose('teacher_plan_learning',{title:'从函数到组合',summary:'先理解单个函数，再验证函数组合。',phases:[{title:'理解与实践',topics:[{...shared,key:'basics',title:'函数基础',dependencies:[],sessions:[{title:'理解输入与返回值',objective:'读资料，解释函数输入与返回值。'}]},{...shared,key:'compose',title:'函数组合',dependencies:['basics'],sessions:[{title:'完成组合计算',objective:'组合两个函数并解释数据流。'}]}]}]});
  }else if(L.assessment){
   const a=L.assessment,r=a.rounds.at(-1),wrong=extended&&((a.kind==='LEARN'&&L.assessments.filter(x=>x.kind==='LEARN'&&x.status==='COMPLETED').length===0)||(a.kind==='REVIEW'&&L.assessments.filter(x=>x.kind==='REVIEW'&&x.status==='COMPLETED').length===1));
   if(!r)choose('teacher_assessment_question',{question:'隔离验收题：若 double(x) 返回 x×2，inc(x) 返回 x+1，inc(double(3)) 是多少？请解释计算顺序。',requirement_ids:a.requirement_ids});
   else if(!invoked.includes('teacher_assessment_feedback'))choose('teacher_assessment_feedback',{round_id:r.id,feedback:wrong?'回答先加再乘，将内外层顺序颠倒。':'回答给出了先乘再加的过程，符合本次隔离验收要求。'});
   else choose('teacher_finish_assessment',{summary:wrong?'本次回答仍混淆函数组合的计算顺序，需要回看例题并重新验证。':'本次隔离验收考察完成，回答和反馈已保存。',profile:wrong?'需要继续验证计算顺序。':'能说明函数输入、返回值和组合过程。',change_summary:'根据本次实际提交的回答记录证据。',relations:a.requirement_ids.map(id=>({requirement_id:id,relation:wrong?'CONTRADICTS':'SUPPORTS'})),readiness:L.readiness_items.map(i=>({readiness_id:i.id,judgment:wrong?'本次回答显示顺序混淆。':'本次回答支持要求；这是流程验收用固定判断。',evidence_ids:[]})),gaps:wrong?[{requirement_id:a.requirement_ids[0],description:'函数组合的计算顺序混淆',reason:'回答先算 inc(3)，再计算 double(4)，与题目顺序相反。'}]:[],completion_recommended:a.kind==='FINAL'});
  }
  calls.push({module:task.module,tool:tool||'reply'});
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:tool?'tool_calls':'stop',message:tool?{role:'assistant',content:null,tool_calls:[{id:'call_'+calls.length,type:'function',function:{name:tool,arguments:JSON.stringify(args)}}]}:{role:'assistant',content:'已保存，请到目标进度查看下一步并确认。'}}]}));
 }catch(e){errors.push(e.message);res.writeHead(500);res.end('isolated fixture error');}});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const profile=await post('models/profile',{name:'学习闭环隔离模型',base_url:`http://127.0.0.1:${server.address().port}/v1`,model:'learning-loop-smoke'});
  for(const role of ['material','capabilities','roadmap','assessment','review','final'])await post('agents/configure',{role,mode:'API',profile_id:profile.id});
  await click('[data-view="resources"]');await click('[data-action="new-resource"]');
  const material='# 函数与组合\n\n函数接收输入并返回输出。double(x)=x*2，inc(x)=x+1。\n\n## 组合计算\n\ninc(double(3)) 先得到 6，再得到 7。';
  await exec(`{const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(material)}],'函数入门.md',{type:'text/markdown'}));const el=document.querySelector('#resource-file');el.files=dt.files;el.dispatchEvent(new Event('change'));}`);
  await submit();await closeWait();
  await until(()=>exec(`!document.querySelector('#embedded-reader').hidden`),'导入后进入阅读器');
  const frame=main.webContents.mainFrame.frames.find(f=>f.url.includes('/reader.html'));
  await until(()=>frame.executeJavaScript(`!!document.querySelector('#formal-goal') && document.querySelector('#reading-title').textContent.includes('函数')`),'资料阅读完成');
  await until(async()=>{const ready=await state();return ready.study.progress.some(p=>ready.resources.some(r=>r.id===p.resource_id&&r.title==='函数入门.md'));},'正文加载并记录阅读位置');
  await frame.executeJavaScript(`document.querySelector('#formal-goal').click()`);
  await until(()=>exec(`!!document.querySelector('#goal-domain')`),'从阅读器创建目标');
  await set('#goal-title','函数组合学习闭环验收');await set('#goal-domain','编程');await set('#goal-scope','解释并应用函数组合');await submit();await closeWait();
  let s=await state();const goal=s.goals.find(g=>g.title==='函数组合学习闭环验收'),resource=s.resources.find(r=>r.goal_id===goal.id);
  assert.equal(resource.role,'PRIMARY');await until(async()=>{const saved=await state();return saved.study.progress.some(p=>p.resource_id===resource.id);},'阅读位置已保存');
  const journey=async stage=>{await click('[data-view="journey"]');await until(()=>exec(`document.querySelector('.journey-next')?.dataset.stage===${JSON.stringify(stage)}`),'目标下一步 '+stage);};
  await journey('material');await click('[data-action="journey-next"]');
  await until(async()=>{const t=await state();return t.learning.material_analysis.length&&t.jobs.every(j=>!['RUNNING','QUEUED'].includes(j.status)||!t.conversations.some(c=>c.id===j.conversation_id&&c.goal_id===goal.id));},'资料实际分析');
  await journey('capabilities');await click('[data-action="journey-next"]');
  await until(async()=>{const t=await state();return t.learning.capability_sets.length&&t.jobs.every(j=>!['RUNNING','QUEUED'].includes(j.status)||!t.conversations.some(c=>c.id===j.conversation_id&&c.goal_id===goal.id));},'能力提案');
  await journey('confirm-cap');await click('[data-action="journey-next"]');await click('[data-action="v2-accept-cap"]');
  await until(async()=>(await state()).learning.capability_sets.some(x=>x.status==='ACCEPTED'),'用户确认能力');
  const answer=async(kind,wrong=false)=>{
   await until(async()=>(await state()).learning.assessments.some(a=>a.kind===kind&&a.status==='WAITING_ANSWER'),'出题 '+kind);
   await until(()=>exec(`document.querySelector('.messages')?.textContent.includes('隔离验收题') && !document.querySelector('#message-input').disabled`),'显示当前题目');
   await set('#message-input',wrong?'结果为 8。先计算 inc(3) 得到 4，再计算 double(4) 得到 8。':'结果为 7。先计算 double(3) 得到 6，再把 6 传给 inc 得到 7。');
   await exec(`document.querySelector('#composer').requestSubmit()`);
   await until(async()=>(await state()).learning.assessments.filter(a=>a.kind===kind).at(-1)?.status==='COMPLETED','保存回答与结论 '+kind);
  };
  await journey('diagnostic');await click('[data-action="journey-next"]');await until(()=>exec(`!!document.querySelector('#vkind')`),'初始诊断确认');await submit();await closeWait();await answer('INITIAL_DIAGNOSTIC');
  await journey('roadmap');await click('[data-action="journey-next"]');
  await until(async()=>{const t=await state();return t.proposals.length&&t.jobs.every(j=>!['RUNNING','QUEUED'].includes(j.status)||!t.conversations.some(c=>c.id===j.conversation_id&&c.goal_id===goal.id));},'路线提案');
  await journey('confirm-roadmap');await click('[data-action="journey-next"]');await click('[data-action="accept"]');
  await until(async()=>(await state()).sessions.length===2,'确认两项路线任务');
  await journey('schedule');await capture('learning-journey');await click('[data-action="journey-next"]');
  await until(()=>exec(`!!document.querySelector('#batch-start')`),'批量排期设置');
  const today=await exec(`new Date().toLocaleDateString('sv-SE')`);
  await set('#batch-start',today);await exec(`document.querySelectorAll('#dialog-form input[type=checkbox]').forEach(x=>{x.checked=true;x.dispatchEvent(new Event('input',{bubbles:true}));})`);
  await submit();await until(()=>exec(`document.querySelector('#schedule-preview')?.textContent.includes('2 项 / 60 分钟')`),'排期预览');
  assert.equal((await state()).calendar.length,0,'预览不能写入日历');await capture('learning-schedule');await submit();await closeWait();
  s=await state();assert.equal(s.calendar.length,2);assert.equal(s.calendar[0].title,'理解输入与返回值');assert.equal(s.evidence.length,1);
  await click('[data-view="home"]');await until(()=>exec(`document.querySelector('.today-learning')?.textContent.includes('理解输入与返回值')`),'首页每日任务');await capture('learning-today');
  for(const entry of s.calendar){
   await click('[data-view="home"]');await click(`[data-action="calendar-study"][data-id="${entry.id}"]`);
   await until(()=>exec(`!!document.querySelector('#task-progress')`),'学习任务');await set('#task-progress','100');await set('#task-notes','已阅读并完成例题，随后验证理解。');
   if(entry===s.calendar[0]){
    await click('[data-action="task-review"]');await until(()=>exec(`!!document.querySelector('#rdate')`),'从任务安排复习');await set('#rdate',today);await submit();await closeWait();
    const before=await state();assert.equal(before.evidence.length,1,'学习100%不能制造证据');assert.ok(before.sessions.every(x=>x.status==='PLANNED'));assert.equal(before.calendar.find(x=>x.id===entry.id).progress,100);
    await click('[data-view="home"]');await until(()=>exec(`!!document.querySelector('.due-reviews [data-action="journey-start-review"]')`),'首页到期复习');await capture('learning-review-due');
    await click('.due-reviews [data-action="journey-start-review"]');await answer('REVIEW');assert.equal((await state()).learning.reviews[0].status,'DONE');
    await click('[data-view="home"]');await click(`[data-action="calendar-study"][data-id="${entry.id}"]`);await until(()=>exec(`!!document.querySelector('#task-progress')`),'返回学习任务');
   }
   await click('[data-action="task-assess"]');await until(()=>exec(`document.querySelector('#vkind')?.value==='LEARN'`),'自愿学习考察');await submit();await closeWait();await answer('LEARN',extended&&entry===s.calendar[0]);
  }
  if(extended)followups=await require('./followups-smoke.cjs').run({main,exec,click,set,submit,closeWait,until,capture,state,answer,journey,goal,resource,today});
  await journey('final');await capture('learning-complete-route');await click('[data-action="journey-next"]');await click('[data-action="v2-begin"]');await until(()=>exec(`!!document.querySelector('#vkind')`),'最终面试设置');await set('#vkind','FINAL');await submit();await closeWait();await answer('FINAL');
  await click('[data-view="learning"]');await click('[data-action="v2-finish-goal"]');await until(()=>exec(`!!document.querySelector('#endstatus')`),'目标结束确认');await exec(`document.querySelector('#dialog-form input[type=checkbox]').checked=true`);await submit();await closeWait();
  await journey('ended');await capture('learning-ended');
  s=await state();assert.equal(s.goals.find(g=>g.id===goal.id).status,'COMPLETED');assert.equal(s.evidence.length,evidenceCount);assert.equal(s.learning.goal_snapshots.length,1);assert.equal(s.learning.reviews[0].status,'DONE');assert.ok(s.calendar.filter(e=>!e.cancelled).every(e=>e.progress===100));assert.ok(s.sessions.every(x=>x.status==='COMPLETED'));assert.equal(errors.length,0);
  await main.loadURL(base);await until(()=>exec(`!!document.querySelector('[data-view="journey"]')`),'重载');
  const persisted=await state();if(process.argv.includes('--remediation-smoke')){assert.equal(persisted.remediation.length,2);assert.equal(persisted.calendar.filter(e=>e.cancelled).length,1);}assert.equal(persisted.evidence.length,evidenceCount);assert.equal(persisted.resources.find(r=>r.id===resource.id).goal_id,goal.id);if(extended)assert.equal(persisted.learning.review_sources.length,2);
  const result={ok:true,localMock:true,importFromUI:true,readerToGoal:true,materialAnalysis:true,confirmedCapabilities:true,initialDiagnostic:true,confirmedRoadmap:true,previewBeforeCommit:true,batchTasks:2,dailyProgress:true,reviewFromToday:true,learningAssessments:2,finalInterview:true,goalSnapshot:true,evidenceCount,reloadPreserved:true,...(followups?{followups}:{}),calls};
  writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,'learning-loop.json'),JSON.stringify(result,null,2));console.log('LEARNING_LOOP_SMOKE_OK '+JSON.stringify(result));
 }catch(e){writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,'learning-loop-failure.json'),JSON.stringify({error:e.message,calls,state:await state()},null,2));await capture('learning-loop-failure');throw e;}
 finally{await post('models/enabled',{enabled:false});server.closeAllConnections();await new Promise(r=>server.close(r));}
};
