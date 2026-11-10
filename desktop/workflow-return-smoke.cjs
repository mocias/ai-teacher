const assert=require('node:assert/strict');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {join}=require('node:path');
const {randomUUID}=require('node:crypto');

// Run only against the smoke launcher's isolated database/profile. All fixture
// learning data goes through the existing browser APIs and authenticated tools.
exports.run=async(main,base)=>{
 assert.ok(process.env.TEACHER_SMOKE_PROFILE&&process.env.TEACHER_DATA_DIR,'isolated smoke environment required');
 const output=process.env.TEACHER_SMOKE_OUTPUT;mkdirSync(output,{recursive:true});main.showInactive();
 const exec=code=>main.webContents.executeJavaScript(code),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const api=(path,data)=>exec(`fetch('/api/${path}',${data===undefined?'{}':`{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(data)})}`}).then(async response=>{const value=await response.json();if(!response.ok)throw Error(value.error);return value;})`);
 const state=()=>api('state');
 const token=readFileSync(join(process.env.TEACHER_DATA_DIR,'agent-token'),'utf8').trim();
 const tool=async(name,args)=>{const response=await fetch(base+'/api/agent/tool',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({name,arguments:args})});const value=await response.json();if(!response.ok)throw Error(value.error);return value;};
 async function until(check,label){let last;for(let n=0;n<240;n++){try{const value=await check();if(value)return value;}catch(error){last=error;}await pause(100);}throw Error(label+(last?' · '+last.message:'')+'\n'+await exec('document.body.innerText.slice(-2200)'));}
 async function click(selector){await until(()=>exec(`!!document.querySelector(${JSON.stringify(selector)})`),selector);await exec(`document.querySelector(${JSON.stringify(selector)}).click()`);await pause(180);}
 const screenshot=async name=>{for(let attempt=0;;attempt++)try{writeFileSync(join(output,name+'.png'),(await main.webContents.capturePage()).toPNG());break;}catch(error){if(error.message!=='UnknownVizError'||attempt>=2)throw error;await pause(200);}};
 const protectedState=value=>({goals:value.goals,sessions:value.sessions,proposals:value.proposals,evidence:value.evidence,profiles:value.profiles,learning:value.learning,goal_resources:value.goal_resources,calendar:value.calendar,rolling_plan:value.rolling_plan,session_chats:value.session_chats});
 const report={nativeElectron:true,packaged:require('electron').app.isPackaged,fixture:'browser APIs + authenticated Teacher tools; no direct SQL',checks:{},screenshots:[]};
 let debuggerOwned=false;const posts=[];
 const listener=(_event,method,params)=>{if(method==='Network.requestWillBeSent'&&params.request.method==='POST')posts.push({path:new URL(params.request.url).pathname});};
 try{
  // An ended initial diagnostic is a planning prerequisite here, not evidence
  // that the fixture learner has mastered anything.
  const goalResult=await api('goals',{title:'Return Fixture 学习返回验收',domain:'隔离界面验收',scope:'验证显示导航，不记录掌握程度'}),goalId=goalResult.goal.id,planningId=goalResult.conversation.id;
  const resource=await api('resources',{goal_id:goalId,title:'Return Fixture Markdown 参考资料',role:'REFERENCE',scope:'全文',file:{name:'return-fixture.md',base64:Buffer.from('# Return fixture\n\n'+('原生阅读标签必须保留，任务学习草稿与日程未保存记录必须返回。\n\n'.repeat(80))).toString('base64')}});
  const capability=await tool('teacher_propose_capabilities',{goal_id:goalId,items:[{title:'理解返回流程',kind:'CORE',requirements:[{node:'返回入口',description:'解释并验证原页面返回'}]}],request_id:randomUUID()});await api('capabilities/decide',{id:capability.proposal_id,accept:true});
  let snapshot=await state();const requirement=snapshot.learning.requirements.find(row=>row.goal_id===goalId).id;
  const diagnosis=await api('assessments',{goal_id:goalId,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',scope:'仅为界面夹具正式提前结束',requirement_ids:[requirement],resource_ids:[],request_id:randomUUID()});await api('assessments/end',{id:diagnosis.assessment_id});
  const proposal=await tool('teacher_plan_learning',{goal_id:goalId,title:'返回验收路线',summary:'两项可执行的界面验收任务',phases:[{title:'界面验收',topics:[{key:'return',title:'返回原上下文',requirement_ids:[requirement],resource_ids:[resource.id],dependencies:[],sessions:[{title:'返回任务学习',objective:'验证草稿和阅读位置保留'},{title:'返回日程记录',objective:'验证未保存学习记录不被导航写入'}]}]}],request_id:randomUUID()});await api('proposals/decide',{id:proposal.proposal_id,accept:true});
  snapshot=await state();const tasks=snapshot.sessions.filter(row=>row.goal_id===goalId),task=tasks[0];assert.equal(tasks.length,2);
  const learning=await api('sessions/learning',{session_id:task.id,request_id:randomUUID()}),learningId=learning.conversation_id;
  for(let n=0;n<7;n++){const sent=await api('messages',{conversation_id:learningId,content:'已保存的任务学习记录 '+n+'\n'+('保留阅读位置与任务上下文。'.repeat(110)),task_kind:'chat',request_id:randomUUID(),...(n===0?{attachment_resource_ids:[resource.id]}:{})});await api('jobs/cancel',{id:sent.job_id});}
  const today=await exec(`(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()`);
  const entry=await api('calendar',{title:task.title,date:today,time:'',duration:30,session_id:task.id});
  const discussion=await api('discussions',{request_id:randomUUID()});
  report.ids={goalId,planningId,learningId,sessionId:task.id,calendarId:entry.id,resourceId:resource.id};
  await main.loadURL(base+'/?view=chat&goal_id='+goalId+'&conversation_id='+planningId);
  await until(()=>exec(`document.querySelector('.chatitem.selected')?.dataset.chat===${JSON.stringify(planningId)}`),'原规划对话');
  if(!main.webContents.debugger.isAttached()){main.webContents.debugger.attach('1.3');debuggerOwned=true;}
  main.webContents.debugger.on('message',listener);await main.webContents.debugger.sendCommand('Network.enable');
  const beforeNavigation=protectedState(await state());let expectedProtected=beforeNavigation;
  await click('[data-action="session-route"]');
  await until(()=>exec(`document.body.dataset.view==='plan'&&!!document.querySelector('.rolling-plan [data-action="task-chat"][data-id="${task.id}"]')`),'路线近期任务直接答疑入口');
  assert.equal(await exec(`(()=>{const n=document.querySelector('.rolling-plan [data-action="task-chat"][data-id="${task.id}"]');const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&!n.closest('details:not([open])')})()`),true,'任务答疑入口直接可见');
  const togglePosts=posts.length;
  await click('.rolling-adjustments>summary');await click('.rolling-adjustments>summary');
  assert.deepEqual(posts.slice(togglePosts),[],'队列设置折叠仅改变显示');assert.deepEqual(protectedState(await state()),beforeNavigation);
  await click('.rolling-adjustments>summary');
  await exec(`window.returnQueueInput=document.querySelector('#rolling-limit');returnQueueInput.value='3';returnQueueInput.focus();window.returnQueueAncestors=[];for(let n=returnQueueInput.parentElement;n;n=n.parentElement){returnQueueAncestors.push(n);if(n.id==='main')break;}window.returnQueueRow=document.querySelector('.rolling-task')`);
  await api('discussions/input',{conversation_id:discussion.conversation_id,content:'用于触发一次真实 SSE 刷新'});const afterStimulus=posts.length;
  await until(()=>exec(`returnQueueRow!==document.querySelector('.rolling-task')`),'队列真实 SSE 刷新');
  assert.equal(await exec(`returnQueueInput===document.querySelector('#rolling-limit')&&document.activeElement===returnQueueInput&&returnQueueInput.value==='3'&&returnQueueAncestors.every((n,i)=>n.isConnected&&(i?returnQueueAncestors[i-1].parentElement:returnQueueInput.parentElement)===n)`),true,'刷新保留队列输入及全部祖先、草稿和焦点');
  assert.deepEqual(posts.slice(afterStimulus),[]);assert.deepEqual(protectedState(await state()),beforeNavigation);
  report.checks.queueDisplayOnlyAndSseEditorIdentity=true;
  await click('.rolling-plan [data-action="task-chat"][data-id="'+task.id+'"]');
  await until(()=>exec(`document.querySelector('.chatitem.selected')?.dataset.chat===${JSON.stringify(learningId)}`),'复用任务已有学习对话');assert.deepEqual(protectedState(await state()),beforeNavigation);report.checks.planningRouteQueueReusesLearningChat=true;

  const draft='任务学习尚未发送的中文草稿';
  await exec(`{const input=document.querySelector('#message-input');input.value=${JSON.stringify(draft)};input.dispatchEvent(new Event('input',{bubbles:true}));const list=document.querySelector('.messages');list.scrollTop=73;}`);
  const savedScroll=await exec(`document.querySelector('.messages').scrollTop`);assert.ok(savedScroll>0,'夹具必须有真实可滚动历史');
  const openFile='[data-action="reader-open"][data-id="'+resource.id+'"]';
  await click('.message-attachments '+openFile);
  await until(()=>exec(`!document.querySelector('#embedded-reader').hidden&&!document.querySelector('#reader-return').hidden`),'任务资料阅读器及返回入口');assert.match(await exec(`document.querySelector('#reader-return').textContent`),/返回任务学习/);
  await until(async()=>{try{return (await exec(`window.teacherDesktop.command('snapshot')`))?.content?.includes('原生阅读标签必须保留');}catch{return false;}},'原生 Markdown 正文就绪');
  const nativeView=main.contentView.children.find(view=>view.webContents?.getURL().includes(resource.id));assert.ok(nativeView);const nativeId=nativeView.webContents.id;
  await exec(`window.returnReaderFrame=document.querySelector('#reader-frame')`);
  const tabId=await exec(`document.querySelector('#reader-frame').contentDocument.querySelector('#tabs [data-tab].active').dataset.tab`);
  const assertReaderPreserved=async()=>{assert.equal(await exec(`returnReaderFrame===document.querySelector('#reader-frame')&&returnReaderFrame.isConnected`),true,'阅读器 iframe 持续挂载');assert.equal(main.contentView.children.find(view=>view.webContents?.getURL().includes(resource.id))?.webContents.id,nativeId,'原生正文 WebContents 未被替换');assert.equal(await exec(`document.querySelector('#reader-frame').contentDocument.querySelector('#tabs [data-tab].active').dataset.tab`),tabId,'阅读标签身份保留');};
  await click('#reader-return');await until(()=>exec(`document.querySelector('.chatitem.selected')?.dataset.chat===${JSON.stringify(learningId)}`),'回到同一任务对话');assert.equal(await exec(`document.querySelector('#message-input').value`),draft);assert.ok(Math.abs((await exec(`document.querySelector('.messages').scrollTop`))-savedScroll)<=2,'任务对话阅读位置恢复');await assertReaderPreserved();
  await screenshot('workflow-return-task');report.screenshots.push('workflow-return-task.png');report.checks.taskChatDraftScrollAndReaderIdentity=true;

  await click('[data-action="session-route"]');await click('.rolling-plan [data-action="detail-session"][data-id="'+task.id+'"]');await until(()=>exec(`document.querySelector('#editor').open&&document.querySelector('#editor').dataset.detailType==='session'`),'任务详情弹窗');
  await click('#editor '+openFile);assert.match(await exec(`document.querySelector('#reader-return').textContent`),/返回任务详情/);await click('#reader-return');
  assert.equal(await exec(`document.querySelector('#editor').open&&document.querySelector('#editor').dataset.detailType==='session'&&document.querySelector('#editor').dataset.detailId===${JSON.stringify(task.id)}`),true,'恢复准确的任务详情');await assertReaderPreserved();report.checks.taskDetailModalRestored=true;
  await click('#editor [data-action="calendar-study"][data-id="'+entry.id+'"]');await until(()=>exec(`document.querySelector('#editor').open&&document.querySelector('#editor').dataset.studyEntry===${JSON.stringify(entry.id)}`),'学习记录弹窗');
  await exec(`document.querySelector('#task-progress').value='37';document.querySelector('#task-notes').value='未保存的中文记录，阅读资料后继续编辑';`);
  const calendarBefore=(await state()).calendar,calendarPostMark=posts.length;
  await click('#editor '+openFile);assert.match(await exec(`document.querySelector('#reader-return').textContent`),/返回学习记录/);const calendarSaved=(await state()).calendar,savedEntry=calendarSaved.find(row=>row.id===entry.id);assert.equal(savedEntry.progress,37);assert.equal(savedEntry.notes,'未保存的中文记录，阅读资料后继续编辑');assert.equal(posts.slice(calendarPostMark).filter(row=>row.path==='/api/calendar/progress').length,1,'保持原有进入阅读器前保存一次的行为');expectedProtected={...beforeNavigation,calendar:calendarSaved};const returnPostMark=posts.length;await click('#reader-return');
  assert.deepEqual(await exec(`({open:document.querySelector('#editor').open,id:document.querySelector('#editor').dataset.studyEntry,progress:document.querySelector('#task-progress').value,notes:document.querySelector('#task-notes').value})`),{open:true,id:entry.id,progress:'37',notes:'未保存的中文记录，阅读资料后继续编辑'});
  assert.deepEqual((await state()).calendar,calendarSaved,'返回操作不再次写入日程');assert.equal(posts.slice(returnPostMark).some(row=>row.path==='/api/calendar/progress'),false);await assertReaderPreserved();await screenshot('workflow-return-calendar');report.screenshots.push('workflow-return-calendar.png');report.checks.calendarSavedOnceOnOpenAndRestoredWithoutReturnWrites=true;await exec(`document.querySelector('#task-progress').value='58';document.querySelector('#task-notes').value='关闭后遗留的未保存字段，不得污染队列导航';`);
  await click('#editor [data-action="close-dialog"]');assert.equal(await exec(`!!document.querySelector('#task-progress')&&!document.querySelector('#editor').open`),true,'隐藏弹窗保留旧进度字段，覆盖真实陈旧字段风险');
  const hiddenMark=posts.length;await click('.rolling-plan [data-action="task-chat"][data-id="'+task.id+'"]');await until(()=>exec(`document.querySelector('.chatitem.selected')?.dataset.chat===${JSON.stringify(learningId)}`),'从队列直接进入学习');assert.deepEqual((await state()).calendar,calendarSaved,'隐藏旧字段不得写入日程');assert.equal(posts.slice(hiddenMark).some(row=>row.path==='/api/calendar/progress'),false);report.checks.hiddenCalendarFieldsNeverAutoSave=true;

  await click('nav [data-view="resources"]');await until(()=>exec(`!!document.querySelector('#filter')`),'资料库');
  await exec(`{const filter=document.querySelector('#filter');filter.value='Return Fixture';filter.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await click('[data-card="resource"][data-id="'+resource.id+'"] '+openFile);assert.match(await exec(`document.querySelector('#reader-return').textContent`),/返回资料库/);await click('#reader-return');
  assert.equal(await exec(`document.body.dataset.view==='resources'&&document.querySelector('#filter').value==='Return Fixture'`),true,'返回资料库并恢复过滤条件');await assertReaderPreserved();
  const final=await state();assert.deepEqual(protectedState(final),expectedProtected,'除原有的进入阅读器前单次保存外，显示导航不改变教学业务数据或日程');report.checks.resourcesFilterAndReaderIdentity=true;report.checks.allProtectedLearningStateUnchanged=true;
  await screenshot('workflow-return-resources');report.screenshots.push('workflow-return-resources.png');report.passed=true;
 }catch(error){report.passed=false;report.error=error.stack||error.message;report.visible=await exec('document.body.innerText.slice(-2500)').catch(()=>null);throw error;}
 finally{main.webContents.debugger.removeListener('message',listener);if(debuggerOwned&&main.webContents.debugger.isAttached())main.webContents.debugger.detach();report.posts=posts;writeFileSync(join(output,'workflow-return-result.json'),JSON.stringify(report,null,2));}
 console.log("WORKFLOW_RETURN_SMOKE_OK "+JSON.stringify({passed:report.passed,checks:report.checks}));return report;
};
