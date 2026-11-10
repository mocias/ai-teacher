const assert=require('node:assert/strict');
const {mkdtempSync,writeFileSync,mkdirSync,rmSync}=require('node:fs');
const {join,resolve,dirname,basename}=require('node:path');
const {tmpdir}=require('node:os');
const {randomUUID}=require('node:crypto');

// Native Chromium input, real HTTP routes and task-scoped manual tools. This
// fixture never opens the user's profile, edits SQL, or calls an external model.
exports.run=async(main,base)=>{
 assert.match(process.env.TEACHER_DATA_DIR||'',/teacher-desktop-smoke-/,'choices require the isolated desktop smoke data directory');
 const exec=code=>main.webContents.executeJavaScript(code);
 const until=async(fn,label)=>{const end=Date.now()+25000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,80));}throw Error('Choice smoke timed out: '+label+'\n'+await exec('document.body.innerText.slice(-2200)'));};
 const request=(path,body,headers={})=>exec(`fetch(${JSON.stringify('/api/'+path)},{${body===undefined?'':"method:'POST',body:JSON.stringify("+JSON.stringify(body)+"),"}headers:${JSON.stringify({'Content-Type':'application/json',...headers})}}).then(async r=>{const value=await r.json();if(!r.ok)throw Error(value.error||JSON.stringify(value));return value;})`);
 const post=(path,body)=>request(path,body),state=()=>request('state'),messages=c=>request('messages?conversation_id='+encodeURIComponent(c));
 const tokens={};
 const tool=(role,name,args={})=>request('agents/tool',{role,name,arguments:args},{Authorization:'Bearer '+tokens[role]});
 const claim=async(role,c)=>{const value=await tool(role,'teacher_claim_message',{conversation_id:c});assert.ok(value.job,'manual '+role+' task exists');return value;};
 const leased=c=>({job_id:c.job.id,lease_token:c.job.lease_token,request_id:randomUUID()});
 const card=q=>`article[data-message-id="${q}"] [data-choice-card]`;
 const option=(q,id)=>card(q)+` [data-choice-option="${id}"]`;
 const open=async(goal,c)=>{await main.loadURL(base+'/?view=chat&goal_id='+goal+'&conversation_id='+c);await until(()=>exec(`!!document.querySelector('#message-input')`),'chat editor');};
 const waitCard=q=>until(()=>exec(`!!document.querySelector(${JSON.stringify(card(q))})`),'choice '+q);
 const waitAnswered=async(c,q)=>until(async()=>(await messages(c)).find(m=>m.id===q)?.choice?.status==='ANSWERED','persisted choice answer');
 const debuggerApi=main.webContents.debugger,ownedDebugger=!debuggerApi.isAttached();
 if(ownedDebugger)debuggerApi.attach('1.3');
 const command=(name,args)=>debuggerApi.sendCommand(name,args);
 const pointer=(p,count=1)=>{for(let i=1;i<=count;i++){main.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:i});main.webContents.sendInputEvent({type:'mouseUp',...p,button:'left',clickCount:i});}};
 const point=async selector=>{
  await until(()=>exec(`!!document.querySelector(${JSON.stringify(selector)})`),selector);
  // A lesson conversation lives inside an initially collapsed group. Expand
  // each ancestor through its visible summary, just as a person must do.
  for(let attempt=0;attempt<8;attempt++){
   const summary=await exec(`(()=>{const target=document.querySelector(${JSON.stringify(selector)}),closed=[];for(let p=target.parentElement;p;p=p.parentElement)if(p.matches('details:not([open])'))closed.push(p);const el=closed.at(-1)?.querySelector(':scope > summary');if(!el)return null;el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
   if(!summary)break;pointer(summary);await exec('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  }
  await until(()=>exec(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});return !!el&&el.getClientRects().length>0&&el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0;})()`),'visible '+selector);
  return exec(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
 };
 const click=async(selector,count=1)=>pointer(await point(selector),count);
 const space=async selector=>{await exec(`document.querySelector(${JSON.stringify(selector)}).focus()`);main.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});main.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});};
 const draft=content=>exec(`(()=>{const el=document.querySelector('#message-input');el.value=${JSON.stringify(content)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const folder=mkdtempSync(join(tmpdir(),'teacher-choice-files-')),attachment=join(folder,'保留草稿.md');
 writeFileSync(attachment,'# 原样保留的独立草稿附件');
 const picker=async()=>{const {root}=await command('DOM.getDocument',{});const {nodeId}=await command('DOM.querySelector',{nodeId:root.nodeId,selector:'[data-attachment-input]'});assert.ok(nodeId);await command('DOM.setFileInputFiles',{nodeId,files:[attachment]});};
 const capture=async name=>{if(!process.env.TEACHER_SMOKE_OUTPUT)return;mkdirSync(process.env.TEACHER_SMOKE_OUTPUT,{recursive:true});writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,name+'.png'),(await main.webContents.capturePage()).toPNG());};
 const choice=type=>({type,options:[{id:'A',text:'先计算内层 double(3)，得到 6。'},{id:'B',text:'再计算外层 inc(6)，得到 7。'},{id:'C',text:'先加再乘，得到 8。\n此项用于检查长文本换行与原文保存。'}]});
 let result;
 try{
  main.showInactive();
  await post('models/enabled',{enabled:false});await post('host/settings',{enabled:false});
  for(const role of ['chat','capabilities','assessment','roadmap']){await post('agents/configure',{role,mode:'MCP',harness:'MANUAL'});tokens[role]=(await post('agents/token',{role})).token;}
  const fixture=await post('goals',{title:'原生选择题隔离验收',domain:'原生验收',scope:'函数组合'}),goal=fixture.goal.id,planning=fixture.conversation.id;
  await post('messages',{conversation_id:planning,task_kind:'capabilities',content:'请整理函数组合能力。',request_id:randomUUID()});
  let job=await claim('capabilities',planning);
  const cap=await tool('capabilities','teacher_propose_capabilities',{...leased(job),items:[{title:'解释函数组合',kind:'CORE',requirements:[{node:'函数组合原生验收',description:'解释内外层次序'}]}]});
  await tool('capabilities','teacher_reply',{...leased(job),content:'请确认函数组合要求。'});await post('capabilities/decide',{id:cap.proposal_id,accept:true});
  const requirements=(await state()).learning.requirements.filter(r=>r.goal_id===goal).map(r=>r.id);assert.equal(requirements.length,1);
  const assessment=await post('assessments',{goal_id:goal,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',scope:'函数组合',requirement_ids:requirements,request_id:randomUUID()});
  job=await claim('assessment',assessment.conversation_id);
  const ask=(j,type)=>tool('assessment','teacher_assessment_question',{...leased(j),question:type==='SINGLE'?'单选：inc(double(3)) 应怎样开始？':'多选：选择计算 inc(double(3)) 的正确步骤。',choice:choice(type),requirement_ids:requirements});
  const q1=await ask(job,'SINGLE');await open(goal,assessment.conversation_id);await waitCard(q1.message_id);
  assert.equal(await exec(`document.querySelector('#message-input').value`),'');
  const jobsBefore=(await state()).jobs.length;
  await click(option(q1.message_id,'A'),2);await waitAnswered(assessment.conversation_id,q1.message_id);
  let history=await messages(assessment.conversation_id),answer=history.find(m=>m.id===history.find(m=>m.id===q1.message_id).choice.answer_message_id);
  assert.equal(answer.content,'A. '+choice('SINGLE').options[0].text);
  let current=await state();assert.equal(current.jobs.length,jobsBefore+1,'double click creates exactly one answer task');
  job=await claim('assessment',assessment.conversation_id);
  let context=await tool('assessment','teacher_get_context',leased(job));
  assert.equal(context.learning.assessment.rounds.find(r=>r.id===q1.round_id).answer_message_id,answer.id,'formal round binds canonical answer');
  assert.equal(current.evidence.length,0,'click alone is not formal evidence');
  await assert.rejects(()=>ask(job,'MULTIPLE'),/反馈/,'next question requires feedback');
  const privateFeedback='私有评价标记：实际选择了先算内层，独立理解尚待核实。';
  const feedback=await tool('assessment','teacher_assessment_feedback',{...leased(job),round_id:q1.round_id,feedback:privateFeedback});
  assert.equal(feedback.published,false);
  const lesson='公开讲解：函数组合先计算内层，再把得到的结果交给外层。';
  const explanation=await tool('assessment','teacher_assessment_explanation',{...leased(job),round_id:q1.round_id,content:lesson});
  assert.equal(explanation.published,true);
  await until(()=>exec(`document.body.innerText.includes(${JSON.stringify(lesson)})`),'public lesson visible before next question');
  assert.equal(await exec(`document.body.innerText.includes(${JSON.stringify(privateFeedback)})`),false,'private evaluation stays hidden');
  const q2=await ask(job,'MULTIPLE');await waitCard(q2.message_id);
  const lessonMessages=await messages(assessment.conversation_id);
  assert.ok(lessonMessages.findIndex(m=>m.id===explanation.message_id)<lessonMessages.findIndex(m=>m.id===q2.message_id));
  await main.reload();await waitCard(q2.message_id);
  await until(()=>exec(`document.body.innerText.includes(${JSON.stringify(lesson)})`),'public lesson survives reload');
  assert.equal(await exec(`document.body.innerText.includes(${JSON.stringify(privateFeedback)})`),false);
  const countBefore=(await messages(assessment.conversation_id)).length;
  await click(option(q2.message_id,'B'));await until(()=>exec(`document.querySelector(${JSON.stringify(option(q2.message_id,'B'))}).getAttribute('aria-pressed')==='true'`),'multiple toggle');
  await space(option(q2.message_id,'A'));await until(()=>exec(`document.querySelector(${JSON.stringify(option(q2.message_id,'A'))}).getAttribute('aria-pressed')==='true'`),'Space toggles multiple option');
  assert.equal((await messages(assessment.conversation_id)).length,countBefore,'toggles never send');
  // Real native composition remains attached to the exact editor while an SSE
  // refresh and choice render occur. No synthetic DOM composition events.
  await click('#message-input');await exec(`window.choiceSmokeEditor=document.querySelector('#message-input');window.choiceSmokeComposition=0;choiceSmokeEditor.addEventListener('compositionstart',()=>choiceSmokeComposition++);window.choiceSmokeFetch=window.fetch;window.choiceSmokeStateReads=0;window.fetch=(url,...args)=>{if(String(url).startsWith('/api/state'))choiceSmokeStateReads++;return choiceSmokeFetch(url,...args);};true`);
  await command('Input.imeSetComposition',{text:'zhongwen',selectionStart:8,selectionEnd:8});
  assert.ok(await exec('choiceSmokeComposition>0'),'Chromium dispatched native composition');
  await post('notes',{goal_id:goal,title:'触发真实 SSE',content:'选择期间保存，不改变考察。'});
  await until(()=>exec('choiceSmokeStateReads>0'),'SSE refresh while composing');
  assert.equal(await exec(`choiceSmokeEditor===document.querySelector('#message-input')`),true,'SSE preserves active editor identity');
  assert.equal(await exec(`document.querySelector(${JSON.stringify(option(q2.message_id,'A'))}).getAttribute('aria-pressed')`),'true','SSE retains multiple selections');
  assert.equal(await exec(`document.querySelector(${JSON.stringify(option(q2.message_id,'B'))}).getAttribute('aria-pressed')`),'true');
  await command('Input.insertText',{text:'中文草稿'});await exec(`window.fetch=choiceSmokeFetch;delete window.choiceSmokeFetch;true`);
  // Delay a committed response until a second physical click has arrived, then
  // lose it. Server state and same-request replay prove no duplicate answer/job.
  await exec(`window.choiceSmokeFetch=window.fetch;window.choiceSmokeRequests=[];window.choiceSmokeLose=true;window.fetch=async(url,options)=>{if(url==='/api/messages'&&options?.method==='POST'&&JSON.parse(options.body).choice_answer){choiceSmokeRequests.push(JSON.parse(options.body));const response=await choiceSmokeFetch(url,options);await new Promise(resolve=>setTimeout(resolve,250));if(choiceSmokeLose){choiceSmokeLose=false;throw Error('choice smoke response lost');}return response;}return choiceSmokeFetch(url,options);};true`);
  const multiJobsBefore=(await state()).jobs.length;
  await click(card(q2.message_id)+' [data-choice-submit]',2);await waitAnswered(assessment.conversation_id,q2.message_id);
  await until(()=>exec(`!document.querySelector(${JSON.stringify(card(q2.message_id))})?.matches('[aria-busy="true"]')`),'response-loss settles');
  const requests=await exec('choiceSmokeRequests');assert.equal(requests.length,1,'pending double click sends one HTTP request');
  const retry=await post('messages',requests[0]);
  history=await messages(assessment.conversation_id);const answered=history.find(m=>m.id===q2.message_id).choice;
  assert.equal(retry.message_id,answered.answer_message_id);assert.deepEqual(answered.selected_option_ids,['A','B']);
  assert.equal(history.find(m=>m.id===answered.answer_message_id).content,choice('MULTIPLE').options.slice(0,2).map(o=>o.id+'. '+o.text).join('\n'));
  assert.equal((await state()).jobs.length,multiJobsBefore+1,'lost response retry does not create another task');
  await exec('window.fetch=choiceSmokeFetch;delete window.choiceSmokeFetch;true');
  await open(goal,assessment.conversation_id);await waitCard(q2.message_id);
  assert.equal(await exec(`document.querySelectorAll(${JSON.stringify(card(q2.message_id)+' [data-choice-option]:disabled')}).length`),3,'saved answers disable after reload');
  job=await claim('assessment',assessment.conversation_id);
  context=await tool('assessment','teacher_get_context',leased(job));assert.equal(context.learning.assessment.rounds.find(r=>r.id===q2.round_id).answer_message_id,answered.answer_message_id);
  await tool('assessment','teacher_assessment_feedback',{...leased(job),round_id:q2.round_id,feedback:'依据实际选择的内外层步骤给出反馈。'});
  await tool('assessment','teacher_finish_assessment',{...leased(job),summary:'完成两道真实点击作答的隔离考察。',profile:'能够识别内外层步骤。',change_summary:'只依据本次作答',relations:requirements.map(requirement_id=>({requirement_id,relation:'SUPPORTS'})),gaps:[],readiness:[],completion_recommended:false});
  await post('messages',{conversation_id:planning,task_kind:'roadmap',content:'请根据诊断安排函数组合练习。',request_id:randomUUID()});job=await claim('roadmap',planning);
  const roadmap=await tool('roadmap','teacher_plan_learning',{...leased(job),title:'原生选择题任务',summary:'完成函数组合练习',phases:[{title:'练习',topics:[{key:'compose',title:'函数组合',requirement_ids:requirements,resource_ids:[],dependencies:[],sessions:[{title:'原生点击练习',objective:'解释次序'}]}]}]});
  await tool('roadmap','teacher_reply',{...leased(job),content:'请确认练习。'});await post('proposals/decide',{id:roadmap.proposal_id,accept:true});
  const session=(await state()).sessions.find(s=>s.goal_id===goal),learning=await post('sessions/learning',{session_id:session.id,request_id:randomUUID()});
  const c=learning.conversation_id,c2=(await post('conversations',{goal_id:goal,title:'保留独立草稿与附件'})).id;
  const publish=async(type,content='请选择学习步骤。')=>{await post('messages',{conversation_id:c,content:'继续当前练习',request_id:randomUUID()});const j=await claim('chat',c);return tool('chat','teacher_reply',{...leased(j),content,choice:choice(type)});};
  const ordinaryBefore=await state(),q3=await publish('SINGLE');
  await open(goal,c2);await draft('独立对话草稿必须保留');await picker();await until(()=>exec(`Number(document.querySelector('#composer').dataset.attachmentCount)===1`),'independent attachment');
  await click(`[data-chat="${c}"]`);await waitCard(q3.message_id);
  await exec(`window.choiceSmokeFetch=window.fetch;window.choiceSmokeHeld=false;window.fetch=async(url,options)=>{if(url==='/api/messages'&&options?.method==='POST'&&JSON.parse(options.body).choice_answer){const response=await choiceSmokeFetch(url,options);choiceSmokeHeld=true;await new Promise(resolve=>window.choiceSmokeRelease=resolve);return response;}return choiceSmokeFetch(url,options);};true`);
  await click(option(q3.message_id,'B'));await until(()=>exec('choiceSmokeHeld'),'committed response held');
  await click(`[data-chat="${c2}"]`);await until(()=>exec(`document.querySelector('[data-chat="${c2}"]')?.getAttribute('aria-current')==='true'`),'switch during pending answer');
  await exec('choiceSmokeRelease();true');await until(()=>exec(`document.querySelector('#message-input')?.value==='独立对话草稿必须保留'`),'other draft after delayed completion');
  assert.equal(await exec(`Number(document.querySelector('#composer').dataset.attachmentCount)`),1,'pending choice leaves attachment intact');
  assert.equal(await exec(`document.querySelector('[data-chat="${c2}"]').getAttribute('aria-current')`),'true','delayed completion never switches view back');
  await exec('window.fetch=choiceSmokeFetch;delete window.choiceSmokeFetch;true');
  job=await claim('chat',c);await tool('chat','teacher_reply',{...leased(job),content:'普通练习反馈，不形成正式证据。'});
  const q4=await publish('MULTIPLE','这是一道会随新回复失效的练习。');
  await post('messages',{conversation_id:c,content:'先讨论其他问题。',request_id:randomUUID()});job=await claim('chat',c);await tool('chat','teacher_reply',{...leased(job),content:'新回复已到达。'});
  await open(goal,c);await waitCard(q4.message_id);assert.equal((await messages(c)).find(m=>m.id===q4.message_id).choice.status,'STALE');
  assert.equal(await exec(`document.querySelectorAll(${JSON.stringify(card(q4.message_id)+' [data-choice-option]:disabled')}).length`),3,'reply disables stale choices');
  const q5=await publish('MULTIPLE','暂停目标后应禁用选项。');await waitCard(q5.message_id);
  await post('goals/status',{id:goal,status:'PAUSED'});await until(async()=>(await messages(c)).find(m=>m.id===q5.message_id).choice.status==='DISABLED','paused choice disabled');
  await until(()=>exec(`document.querySelectorAll(${JSON.stringify(card(q5.message_id)+' [data-choice-option]:disabled')}).length===3`),'paused choice UI');
  const ordinaryAfter=await state();for(const key of ['evidence','profiles'])assert.deepEqual(ordinaryAfter[key],ordinaryBefore[key],'ordinary session choice does not write '+key);
  assert.deepEqual(ordinaryAfter.learning.assessments,ordinaryBefore.learning.assessments,'ordinary choice never starts assessment');
  await post('goals/status',{id:goal,status:'ACTIVE'});await waitCard(q5.message_id);
  await until(()=>exec(`document.querySelectorAll(${JSON.stringify(card(q5.message_id)+' [data-choice-option]:not(:disabled)')}).length===3&&!document.querySelector('#message-input').disabled`),'resumed choice controls');
  for(const width of [1366,1024]){main.setContentSize(width,900);await exec('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await point(card(q5.message_id));const layout=await exec(`(()=>{const composer=document.querySelector('#composer').getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,composer:composer.top>=0&&composer.bottom<=innerHeight+1};})()`);assert.ok(layout.scroll<=layout.width+1,'no horizontal overflow at '+width);assert.equal(layout.composer,true,'composer visible at '+width);await capture('choice-'+width);}
  result={ok:true,isolatedProfile:true,externalModelCalls:0,publicLessonBeforeNextQuestion:true,privateEvaluationHidden:true,lessonSurvivesReload:true,formalSingleNativePointer:true,formalMultiNativeSpace:true,canonicalAnswers:true,formalRoundBinding:true,feedbackGate:true,doubleClickOneTask:true,responseLossIdempotency:true,reloadPersisted:true,selectionsSurviveSSE:true,nativeIMEEditorIdentity:true,pendingSwitchRetainsDraftAndAttachment:true,staleAndPausedDisabled:true,ordinarySessionNoEvidence:true,widths:[1366,1024]};
  if(process.env.TEACHER_SMOKE_OUTPUT)writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,'choice-result.json'),JSON.stringify(result,null,2));
  console.log('CHOICE_SMOKE_OK '+JSON.stringify(result));return result;
 }catch(error){await capture('choice-failure');if(process.env.TEACHER_SMOKE_OUTPUT)writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,'choice-failure.json'),JSON.stringify({error:error.stack,state:await state()},null,2));throw error;}
 finally{try{await exec('if(window.choiceSmokeRelease)choiceSmokeRelease();if(window.choiceSmokeFetch)window.fetch=choiceSmokeFetch;true');}catch{}if(ownedDebugger&&debuggerApi.isAttached())debuggerApi.detach();const cleanup=resolve(folder);assert.equal(dirname(cleanup),resolve(tmpdir()),'cleanup stays directly in temporary directory');assert.match(basename(cleanup),/^teacher-choice-files-/,'cleanup requires fixture directory prefix');rmSync(cleanup,{recursive:true,force:true});}
};
