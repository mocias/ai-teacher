const assert=require('node:assert/strict');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');

exports.run=async(main,base)=>{
 const exec=code=>main.webContents.executeJavaScript(code);
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function until(check,label){const end=Date.now()+25000;let error;while(Date.now()<end){try{const result=await check();if(result)return result;}catch(e){error=e;}await pause(75);}throw Error('Layout smoke timed out: '+label+(error?' · '+error.message:''));}
 const api=(path,body)=>exec(`fetch('/api/'+${JSON.stringify(path)},${body===undefined?'{}':`{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}`}).then(async r=>{const value=await r.json();if(!r.ok)throw Error(value.error||r.status);return value;})`);
 const click=selector=>exec(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const settle=async()=>{await exec('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))');await pause(120);};
 const drag=async(kind,dx,dy,inReader=false)=>{
  const point=await exec(`(()=>{
   const frame=${inReader}?document.querySelector('#reader-frame'):null;
   const doc=frame?.contentDocument||document;
   const handle=doc.querySelector('[data-resize-pane="${kind}"]'),r=handle.getBoundingClientRect(),f=frame?.getBoundingClientRect();
   const x=Math.floor(r.left+r.width/2),y=Math.floor(r.top+r.height/2);
   return {x:x+(f?.left||0),y:y+(f?.top||0),hit:doc.elementFromPoint(x,y)===handle};
  })()`);
  assert.ok(point.hit,kind+' handle is under the pointer');
  const {x,y}=point,wc=main.webContents;
  wc.sendInputEvent({type:'mouseMove',x,y});
  wc.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});
  const dragging=()=>exec(inReader?`document.querySelector('#reader-frame').contentDocument.body.classList.contains('layout-resizing')`:`document.body.classList.contains('layout-resizing')`);
  await until(dragging,kind+' pointer capture');
  wc.sendInputEvent({type:'mouseMove',x:x+dx,y:y+dy,modifiers:['leftButtonDown']});
  wc.sendInputEvent({type:'mouseUp',x:x+dx,y:y+dy,button:'left',clickCount:1});
  await until(async()=>!(await dragging()),kind+' drag finished');
  await settle();
 };
 const size=(selector,axis='width')=>exec(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().${axis}`);
 const output=process.env.TEACHER_SMOKE_OUTPUT;
 const capture=async name=>{if(output){mkdirSync(output,{recursive:true});writeFileSync(join(output,name+'.png'),(await main.webContents.capturePage()).toPNG());}};
 const originalSize=main.getSize();
 main.show();main.focus();main.setSize(1920,1080);
 await api('agents/configure',{role:'chat',mode:'MCP',harness:'MANUAL'});
 await api('agents/configure',{role:'reading',mode:'UNCONFIGURED'});
 const {token}=await api('agents/token',{role:'chat'});
 const tool=async(name,args)=>{const response=await fetch(base+'/api/agents/tool',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({role:'chat',name,arguments:args})});const value=await response.json();if(!response.ok)throw Error(value.error||response.status);return value;};
 const {conversation}=await api('goals',{title:'宽屏布局与折叠回归',domain:'测试'}),cid=conversation.id;
 const answer=async content=>{const {job}=await tool('teacher_claim_message',{conversation_id:cid});assert.ok(job,'manual fixture job claimed');await tool('teacher_reply',{job_id:job.id,lease_token:job.lease_token,content,request_id:crypto.randomUUID()});};
 // Real persisted messages deliberately reflow across widths. No synthetic transcript DOM.
 for(let i=1;i<=8;i++){
  await api('messages',{conversation_id:cid,content:'布局测试问题 '+i,request_id:crypto.randomUUID()});
  await answer('## 第 '+i+' 轮布局讲解\n\n'+Array.from({length:7},(_,p)=>'段落 '+(p+1)+'：'+('学习记录在窗口改变宽度后应该重新排版，保持正在阅读的消息位置以及输入草稿。'.repeat(7))).join('\n\n')+'\n\n第 '+i+' 轮结束');
 }
 await exec(`localStorage.removeItem('teacher.navigation.collapsed');localStorage.removeItem('teacher.conversations.collapsed')`);
 const route=base+'/?view=chat&conversation_id='+encodeURIComponent(cid);
 const loadChat=async()=>{await main.loadURL(route);await until(()=>exec(`document.querySelector('.messages')?.textContent.includes('第 8 轮结束')&&!!document.querySelector('#chatlist-toggle')`),'fixture conversation');await settle();};
 await loadChat();
 // The collapse action lives in the navigation it controls; only restore remains in the top bar.
 assert.equal(await exec(`document.querySelector('#workspace-nav').contains(document.querySelector('#nav-toggle'))`),true);
 assert.equal(await exec(`document.querySelector('.topbar').contains(document.querySelector('#nav-toggle'))`),false);
 assert.equal(await exec(`document.querySelector('#nav-expand').hidden`),true);
 await drag('navigation',40,0);
 assert.equal(await size('#workspace-nav'),256);
 await drag('conversations',36,0);
 assert.equal(await size('#conversation-list'),226);
 await exec(`document.querySelector('#nav-toggle').click()`);
 assert.equal(await exec(`document.querySelector('#workspace-nav').hidden&&getComputedStyle(document.querySelector('[data-resize-pane="navigation"]')).display==='none'`),true);
 await exec(`document.querySelector('#nav-expand').click()`);
 assert.equal(await exec(`document.querySelector('#workspace-nav').hidden`),false);
 const composerBefore=await size('#message-input','height');
 await drag('composer',0,-52);
 assert.equal(await size('#message-input','height'),composerBefore+52);
 await exec(`const input=document.querySelector('#message-input');input.value='手动高度之后继续输入';input.dispatchEvent(new Event('input',{bubbles:true}));`);
 assert.equal(await size('#message-input','height'),composerBefore+52,'manual height is not overwritten by input');
 await loadChat();
 assert.equal(await size('#workspace-nav'),256);
 assert.equal(await size('#conversation-list'),226);
 assert.equal(await size('#message-input','height'),composerBefore+52);
 await exec(`for(const kind of ['navigation','conversations','composer'])document.querySelector('[data-resize-pane="'+kind+'"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));`);
 assert.deepEqual(await exec(`['teacher.navigation.width','teacher.conversations.width','teacher.composer.height'].map(key=>localStorage.getItem(key))`),[null,null,null]);
 await loadChat();
 const controls=()=>exec(`({nav:document.querySelector('#nav-toggle').getAttribute('aria-controls'),chat:document.querySelector('#chatlist-toggle').getAttribute('aria-controls'),navExpanded:document.querySelector('#nav-toggle').getAttribute('aria-expanded'),chatExpanded:document.querySelector('#chatlist-toggle').getAttribute('aria-expanded'),navHidden:document.querySelector('#workspace-nav').hidden,chatHidden:document.querySelector('#conversation-list').hidden,navClass:document.querySelector('.shell').classList.contains('nav-collapsed'),chatClass:document.querySelector('.chatlayout').classList.contains('chatlist-collapsed')})`);
 assert.deepEqual(await controls(),{nav:'workspace-nav',chat:'conversation-list',navExpanded:'true',chatExpanded:'true',navHidden:false,chatHidden:false,navClass:false,chatClass:false},'default layout exposes both panels and matching accessible controls');
 const geometry=()=>exec(`(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};const l=document.querySelector('.messages');return {workspace:rect('.workspace'),main:rect('.conversation-main'),contentWidth:l.clientWidth-parseFloat(getComputedStyle(l).paddingLeft)-parseFloat(getComputedStyle(l).paddingRight),transcript:rect('.messages'),composer:rect('#composer'),input:rect('#message-input'),viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth-innerWidth,gap:l.scrollHeight-l.clientHeight-l.scrollTop,scrollHeight:l.scrollHeight,clientHeight:l.clientHeight};})()`);
 const visible=async label=>{const g=await geometry();assert.ok(g.overflow<=1,label+': no horizontal overflow');assert.ok(g.composer.y>=0&&g.composer.bottom<=g.viewport.height+1,label+': composer inside viewport');assert.ok(g.input.height>0&&g.input.bottom<=g.viewport.height+1,label+': editor remains visible');return g;};
 const initial=await visible('wide expanded');
 assert.ok(initial.contentWidth>1000,'message text uses a wider reading column than the old 700 px cap');
 assert.ok(initial.main.width>=initial.workspace.width-100,'conversation main uses almost all available workspace width');
 assert.ok(initial.transcript.width>850,'wide transcript exceeds previous 700px cap');
 assert.ok(initial.scrollHeight>initial.clientHeight*2,'real history exercises scrolling');
 const latest=async label=>{await settle();assert.ok((await geometry()).gap<=3,label+': follow latest across reflow');};
 const startDraft=async()=>exec(`(()=>{const input=document.querySelector('#message-input');input.value='尚未发送的中文草稿：折叠、刷新之后继续编辑。';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus({preventScroll:true});input.setSelectionRange(4,12);window.__layoutEditor={nodes:[],value:input.value,start:4,end:12};for(let n=input;n;n=n.parentNode)__layoutEditor.nodes.push(n);return true;})()`);
 const preserved=async label=>assert.ok(await exec(`(()=>{const s=window.__layoutEditor,input=document.querySelector('#message-input');let n=input;return !!s&&s.nodes.every(original=>{const same=original===n;n=n?.parentNode;return same;})&&input.value===s.value&&input.selectionStart===s.start&&input.selectionEnd===s.end;})()`),label+': editor, ancestors, draft and selection preserved');
 await startDraft();
 await exec(`document.querySelector('.messages').scrollTo({top:1e7,behavior:'instant'})`);await settle();
 await click('#nav-toggle');await latest('collapse outer navigation');await preserved('navigation collapse');
 let state=await controls();assert.ok(state.navHidden&&state.navClass&&state.navExpanded==='false');
 const navCollapsed=await visible('wide navigation collapsed');assert.ok(navCollapsed.transcript.width>initial.transcript.width+100,'outer collapse expands actual transcript');assert.ok(navCollapsed.composer.width>initial.composer.width+100,'outer collapse expands the composer');
 await click('#chatlist-toggle');await latest('collapse conversation list');await preserved('conversation collapse');
 state=await controls();assert.ok(state.chatHidden&&state.chatClass&&state.chatExpanded==='false');
 const bothCollapsed=await visible('wide both collapsed');assert.ok(bothCollapsed.transcript.width>navCollapsed.transcript.width+100,'conversation collapse expands actual transcript');assert.ok(bothCollapsed.composer.width>navCollapsed.composer.width+100,'conversation collapse expands the composer');
 assert.deepEqual(await exec(`[localStorage.getItem('teacher.navigation.collapsed'),localStorage.getItem('teacher.conversations.collapsed')]`),['1','1']);
 await capture('layout-wide-collapsed');
 const anchor=()=>exec(`(()=>{const list=document.querySelector('.messages'),r=list.getBoundingClientRect(),node=[...list.querySelectorAll('.message')].find(n=>n.getBoundingClientRect().bottom>r.top+1);return {id:node?.dataset.messageId,offset:node?.getBoundingClientRect().top-r.top,scrollTop:list.scrollTop};})()`);
 await exec(`document.querySelector('.messages').scrollTo({top:900,behavior:'instant'})`);await settle();
 const reading=await anchor();assert.ok(reading.id&&reading.scrollTop>0,'history reading fixture');
 const sameAnchor=async label=>{await settle();const now=await anchor();assert.equal(now.id,reading.id,label+': same first visible message');assert.ok(Math.abs(now.offset-reading.offset)<=3,label+': visible message offset stable '+JSON.stringify({reading,now}));};
 await click('#nav-expand');await sameAnchor('expand navigation');await preserved('history navigation toggle');
 await click('#chatlist-toggle');await sameAnchor('expand conversation list');await preserved('history conversation toggle');
 // An actual saved reply must refresh through the live event path while the editor stays mounted.
 await api('messages',{conversation_id:cid,content:'后台更新回归问题',request_id:crypto.randomUUID()});
 await answer('后台 SSE 回复标记：继续保留阅读位置与输入。');
 await until(()=>exec(`document.querySelector('.messages').textContent.includes('后台 SSE 回复标记')`),'real SSE reply');
 await sameAnchor('SSE history refresh');await preserved('SSE refresh');
 await exec(`document.querySelector('.messages').scrollTo({top:1e7,behavior:'instant'})`);await settle();
 await api('messages',{conversation_id:cid,content:'底部跟随回归问题',request_id:crypto.randomUUID()});await answer('底部 SSE 回复标记。\n\n'.repeat(15));
 await until(()=>exec(`document.querySelector('.messages').textContent.includes('底部 SSE 回复标记')`),'latest SSE reply');await latest('SSE latest refresh');await preserved('latest SSE refresh');
 // Preference writes may fail in private/blocked-storage environments; layout still works.
 assert.ok(await exec(`(()=>{const original=Storage.prototype.setItem;try{Storage.prototype.setItem=()=>{throw Error('Storage unavailable')};document.querySelector('#nav-toggle').click();document.querySelector('#chatlist-toggle').click();return document.querySelector('#workspace-nav').hidden&&document.querySelector('#conversation-list').hidden;}finally{Storage.prototype.setItem=original;}})()`),'blocked preference writes do not break either toggle');
 await preserved('blocked storage toggles');
 await click('#nav-expand');await click('#chatlist-toggle');
 assert.deepEqual(await exec(`[localStorage.getItem('teacher.navigation.collapsed'),localStorage.getItem('teacher.conversations.collapsed')]`),['0','0']);
 await loadChat();state=await controls();assert.ok(!state.navHidden&&!state.chatHidden,'stored expanded preferences restored');
 await click('#nav-toggle');await click('#chatlist-toggle');await loadChat();state=await controls();assert.ok(state.navHidden&&state.chatHidden&&state.navClass&&state.chatClass,'stored collapsed preferences restored');
 // Install the failure before app initialization to cover unavailable preference reads too.
 main.webContents.debugger.attach('1.3');let storageScript;
 try{
  await main.webContents.debugger.sendCommand('Page.enable');
  ({identifier:storageScript}=await main.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`window.__layoutStorageBlocked=true;for(const method of ['getItem','setItem']){const original=Storage.prototype[method];Storage.prototype[method]=function(key,...args){if(['teacher.navigation.collapsed','teacher.conversations.collapsed'].includes(key))throw Error('Storage unavailable');return original.call(this,key,...args);};}`}));
  await loadChat();assert.equal(await exec(`window.__layoutStorageBlocked`),true,'storage failure injected before initialization');state=await controls();assert.ok(!state.navHidden&&!state.chatHidden,'failed preference reads fall back to usable expanded layout '+JSON.stringify(state));
  await click('#nav-toggle');await click('#chatlist-toggle');state=await controls();assert.ok(state.navHidden&&state.chatHidden,'failed reads and writes still allow both controls');
 }finally{if(storageScript)await main.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument',{identifier:storageScript});main.webContents.debugger.detach();}
 await loadChat();
 // The settings assistant and discovery composer share the same drag behavior.
 await main.loadURL(base+'/agents.html');await until(()=>exec(`!!document.querySelector('[data-resize-pane="agentRail"]')`),'assistant resize handles');
 const agentBefore=await size('#content','height');
 await drag('agentRail',32,0);await drag('agentComposer',0,-32);
 assert.equal(await size('#agent-navigation'),248);assert.equal(await size('#content','height'),agentBefore+32);
 await main.loadURL(base+'/');await until(()=>exec(`document.querySelector('#home-profile-frame')?.contentDocument?.querySelector('#chat-title')?.textContent==='让 AI 了解我'`),'profile conversation opens by default');
 assert.equal((await api('state')).study.chats.some(chat=>chat.kind==='ONBOARDING'),false,'opening home does not start a model job');
 await exec(`(()=>{const doc=document.querySelector('#home-profile-frame').contentDocument,input=doc.querySelector('#message');input.value='我偏好用实际项目学习';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await click('[data-action="home-conversation"][data-id="discovery"]');
 await click('[data-action="home-conversation"][data-id="profile"]');
 await until(()=>exec(`document.querySelector('#home-profile-frame')?.contentDocument?.querySelector('#message')?.value==='我偏好用实际项目学习'`),'profile draft survives switching conversations');
 await exec(`document.querySelector('#home-profile-frame').contentDocument.querySelector('#chat-form').requestSubmit()`);
 await until(()=>exec(`document.querySelector('#home-profile-frame')?.contentDocument?.querySelector('#messages')?.textContent.includes('我偏好用实际项目学习')`),'real profile message saved');
 await main.loadURL(base+'/');
 await until(()=>exec(`document.querySelector('#home-profile-frame')?.contentDocument?.querySelector('#messages')?.textContent.includes('我偏好用实际项目学习')`),'saved profile conversation restored');
 await click('[data-action="home-conversation"][data-id="discovery"]');await until(()=>exec(`!!document.querySelector('[data-resize-pane="discoveryComposer"]')`),'discovery resize handle');
 const discoveryBefore=await size('#discovery-input','height');
 await drag('discoveryComposer',0,-32);
 assert.equal(await size('#discovery-input','height'),discoveryBefore+32);
 await loadChat();
 main.setSize(960,740);await settle();const narrowCollapsed=await visible('960 collapsed');await capture('layout-narrow-collapsed');
 await click('#nav-expand');await click('#chatlist-toggle');await settle();const narrowExpanded=await visible('960 expanded');await capture('layout-narrow-expanded');
 await drag('conversations',52,0);
 assert.equal(await size('#conversation-list'),242);
 assert.ok(await exec(`Math.abs(document.querySelector('#conversation-list').getBoundingClientRect().right-document.querySelector('.chatmain').getBoundingClientRect().left)<1`),'narrow conversation list stays aligned with the chat');
 await visible('960 resized');
 main.setSize(1920,1080);await settle();
 // Native reader content is a WebContentsView, so DOM geometry alone cannot prove it moved.
 const resource=await api('resources',{title:'外部导航折叠阅读回归',file:{name:'layout-reader.md',base64:Buffer.from('# Layout reader\n\nNative content must move and resize with the workspace.\n\n## Kept content\n\nReader draft stays mounted.').toString('base64')}});
 await exec(`window.teacherDesktop.openReader(${JSON.stringify(resource.id)})`);
 const frame=await until(()=>main.webContents.mainFrame.frames.find(f=>f.url.includes('/reader.html')),'reader frame');
 const ui=code=>frame.executeJavaScript(code),command=(action,args={})=>exec(`window.teacherDesktop.command(${JSON.stringify(action)},${JSON.stringify(args)})`);
 await until(async()=>{const snapshot=await command('snapshot');return snapshot?.content?.includes('Native content must move');},'native reader content');
 const nativeView=()=>main.contentView.children.find(v=>v.webContents?.getURL().includes(resource.id));
 await until(()=>nativeView()?.getVisible(),'native view visible');
 if(await ui(`document.querySelector('#reader-side').hidden`))await ui(`document.querySelector('#reader-side-toggle').click()`);
 assert.ok(await ui(`(()=>{const side=document.querySelector('#reader-side'),composer=document.querySelector('.reader-composer'),thread=document.querySelector('.reader-thread');return Math.abs(side.getBoundingClientRect().bottom-composer.getBoundingClientRect().bottom)<35&&getComputedStyle(thread).overflowY==='auto';})()`),'reader composer is docked at the bottom with an independently scrolling thread');
 await ui(`(()=>{const q=document.querySelector('#question');q.value='阅读问题未发送草稿';q.dispatchEvent(new Event('input',{bubbles:true}));q.focus();q.setSelectionRange(2,6);window.__layoutQuestion=q;})()`);
 const contentBefore=await nativeView().webContents.executeJavaScript(`document.body.innerText`),readerBefore=nativeView().getBounds();
 const readerMatches=async()=>{const expected=await exec(`(()=>{const f=document.querySelector('#reader-frame'),r=f.getBoundingClientRect(),d=f.contentDocument,header=d.querySelector('#reader-header').getBoundingClientRect(),side=d.querySelector('#reader-side');return {x:r.x,y:r.y+header.height,width:r.width-(side.hidden?0:side.getBoundingClientRect().width),height:r.height-header.height};})()`),actual=nativeView().getBounds();return Object.keys(expected).every(k=>Math.abs(actual[k]-expected[k])<=2);};
 await until(readerMatches,'expanded native reader bounds');
 await drag('readerSidebar',-48,0,true);
 await until(async()=>nativeView().getBounds().width===readerBefore.width-48&&await readerMatches(),'reader drag changes native document bounds');
 const questionBefore=await ui(`document.querySelector('#question').getBoundingClientRect().height`);
 await drag('readerComposer',0,-28,true);
 assert.equal(await ui(`document.querySelector('#question').getBoundingClientRect().height`),questionBefore+28);
 await click('#nav-toggle');await until(async()=>{const b=nativeView().getBounds();return b.x<readerBefore.x-100&&b.width>readerBefore.width+100&&await readerMatches();},'outer collapse moves and expands actual native reader');
 const readerAfter=nativeView().getBounds();
 assert.equal(await nativeView().webContents.executeJavaScript(`document.body.innerText`),contentBefore,'native reader content preserved');
 assert.ok(await ui(`window.__layoutQuestion===document.querySelector('#question')&&__layoutQuestion.value==='阅读问题未发送草稿'&&__layoutQuestion.selectionStart===2&&__layoutQuestion.selectionEnd===6`),'reader live input and draft preserved');
 main.setSize(960,740);await until(readerMatches,'narrow native reader bounds');
 const nativeNarrow=nativeView().getBounds(),contentSize=main.getContentSize();assert.ok(nativeNarrow.x>=0&&nativeNarrow.y>=0&&nativeNarrow.x+nativeNarrow.width<=contentSize[0]+1&&nativeNarrow.y+nativeNarrow.height<=contentSize[1]+1,'native reader stays within narrow viewport');
 await capture('layout-reader-narrow');
 main.setSize(...originalSize);
 await main.loadURL(base);
 const emptyPlan=await api('goals',{title:'空白规划入口验收',domain:'测试'});
 const emptyId=emptyPlan.conversation.id;
 await main.loadURL(base+'/?view=chat&conversation_id='+encodeURIComponent(emptyId));
 await until(()=>exec(`document.querySelector('.messages')?.textContent.includes('从你的目标聊起')`),'empty planning transcript');
 assert.equal(await exec(`!!document.querySelector('.planning-invite')`),false);
 await assert.rejects(api('planning-flow/start',{goal_id:emptyPlan.goal.id,conversation_id:emptyId,request_id:crypto.randomUUID()}));
 await api('messages',{conversation_id:emptyId,content:'我想学习编译原理，先从抽象语法树做一个例子。',request_id:crypto.randomUUID()});
 await until(()=>exec(`!!document.querySelector('.planning-invite')`),'planning invitation appears after actual discussion');
 const discussionJob=(await tool('teacher_claim_message',{conversation_id:emptyId})).job;
 await tool('teacher_reply',{job_id:discussionJob.id,lease_token:discussionJob.lease_token,request_id:crypto.randomUUID(),content:'我们先用一棵表达式树做例子。'});
 const manual=async role=>{
  await api('agents/configure',{role,mode:'MCP',harness:'MANUAL'});
  const {token}=await api('agents/token',{role});
  return async (name,args)=>{const response=await fetch(base+'/api/agents/tool',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({role,name,arguments:args})});const value=await response.json();if(!response.ok)throw Error(value.error);return value;};
 };
 const capTool=await manual('capabilities'),assessmentTool=await manual('assessment');
 await api('messages',{conversation_id:emptyId,task_kind:'capabilities',content:'请整理能力要求',request_id:crypto.randomUUID()});
 const capJob=(await capTool('teacher_claim_message',{conversation_id:emptyId})).job;
 const lease=job=>({job_id:job.id,lease_token:job.lease_token,request_id:crypto.randomUUID()});
 const cap=await capTool('teacher_propose_capabilities',{...lease(capJob),items:[{title:'解释表达式树',kind:'CORE',requirements:[{node:'语法树',description:'解释叶节点与父节点'}]}]});
 await capTool('teacher_reply',{...lease(capJob),content:'能力要求已经提交。'});
 await api('capabilities/decide',{id:cap.proposal_id,accept:true});
 const requirement=(await api('state')).learning.requirements.find(row=>row.set_id===cap.proposal_id);
 const assessment=await api('assessments',{goal_id:emptyPlan.goal.id,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',request_id:crypto.randomUUID()});
 const quizId=assessment.conversation_id;
 const first=(await assessmentTool('teacher_claim_message',{conversation_id:quizId})).job;
 await assessmentTool('teacher_assessment_question',{...lease(first),assessment_id:assessment.assessment_id,question:'叶节点表示什么？',requirement_ids:[requirement.id]});
 await main.loadURL(base+'/?view=chat&conversation_id='+encodeURIComponent(quizId));
 await until(()=>exec(`!!document.querySelector('[data-action="assessment-pause"]')`),'assessment can pause');
 await click('[data-action="assessment-pause"]');
 await until(()=>exec(`!!document.querySelector('[data-action="assessment-resume"]')&&document.querySelector('#composer').hidden`),'paused assessment keeps its place');
 await click('[data-action="assessment-resume"]');
 await until(()=>exec(`document.querySelector('.messages')?.textContent.includes('叶节点表示什么？')&&!document.querySelector('#message-input')?.disabled`),'resume returns to same question');
 await click('[data-action="v2-early"]');
 await click('#dialog-form button[type=submit]');
 await until(()=>exec(`document.querySelector('.assessment-outcome')?.textContent.includes('提前结束')&&document.querySelector('#composer').hidden`),'ended assessment has a visible status and no active composer');
 const comment=(await assessmentTool('teacher_claim_message',{conversation_id:quizId})).job;
 await assessmentTool('teacher_reply',{...lease(comment),content:'本次还没有提交作答，暂时无法评价。'});
 await until(()=>exec(`document.querySelector('.assessment-outcome')?.textContent.includes('暂时无法评价')`),'generated comment appears in result');
 await click('[data-action="assessment-continue"]');
 await until(async()=>{const next=(await api('state')).learning.assessments.find(row=>row.parent_id===assessment.assessment_id);return next&&await exec(`document.querySelector('.chattitle')?.textContent.includes('续考')`);},'continuation opens a linked attempt');
 const roadmap=await exec(`(async()=>{
  const {roadmapView,layoutRoadmap}=await import('/roadmap.js');
  const phase='阶段三：阅读分析报告并用可复现的数据说明瓶颈在哪里';
  const items=[
   {key:'a',topic:'基础',phase,dependencies:[]},
   {key:'b',topic:'用 Roofline 和算术强度比较预填充与解码瓶颈',phase,dependencies:['a']},
   {key:'parallel',topic:'并行分支',phase,dependencies:['a']},
   {key:'c',topic:'实验验证',phase,dependencies:['a','b']},
  ];
  const sessions=items.map((item,position)=>({id:String(position),goal_id:'g',proposal_id:'p',position,status:'PLANNED',title:'分析工具输出并核对每个阶段的瓶颈与通信开销'.repeat(position===1?5:1)}));
  const root=document.createElement('section');root.innerHTML=roadmapView({sessions,proposals:[{id:'p',items}]},'g');document.body.append(root);layoutRoadmap(root);
  const canvas=root.querySelector('.roadmap-canvas'),origin=canvas.getBoundingClientRect();
  const cards=[...root.querySelectorAll('.roadmap-node')],mid=cards[1].getBoundingClientRect(),parallel=cards[2].getBoundingClientRect();
  const edges=[...root.querySelectorAll('svg > path')],long=edges[2];
  let crossesCard=false;
  for(let d=0;d<long.getTotalLength();d+=1){
   const {x,y}=long.getPointAtLength(d);
   if(x+origin.left>mid.left&&x+origin.left<mid.right&&y+origin.top>mid.top&&y+origin.top<mid.bottom){crossesCard=true;break;}
  }
  const ports=(side,at)=>edges.filter(edge=>edge.dataset[side]===at).map(edge=>edge.getPointAtLength(side==='from'?0:edge.getTotalLength()).y).sort((a,b)=>a-b);
  const incoming=ports('to','3'),outgoing=ports('from','0');
  const minGap=points=>Math.min(...points.slice(1).map((y,i)=>y-points[i]));
  const clipped=[...root.querySelectorAll('.roadmap-node,.roadmap-node h3,.roadmap-deps,.roadmap-task span')].some(el=>el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1);
  root.remove();return {edges:edges.length,crossesCard,clipped,rowGap:parallel.top-mid.bottom,incomingCount:incoming.length,incomingGap:minGap(incoming),outgoingCount:outgoing.length,outgoingGap:minGap(outgoing)};
 })()`);
 assert.equal(roadmap.edges,4);
 assert.equal(roadmap.crossesCard,false,'cross-column dependency stays outside the intervening card');
 assert.equal(roadmap.clipped,false,'long roadmap labels and task names remain visible');
 assert.ok(roadmap.rowGap>=23,'the next card starts after the measured height of the tall card');
 assert.equal(roadmap.incomingCount,2);
 assert.ok(roadmap.incomingGap>=19,'two prerequisites use separate visible arrowheads: '+JSON.stringify(roadmap));
 assert.equal(roadmap.outgoingCount,3);
 assert.ok(roadmap.outgoingGap>=19,'three outgoing dependencies start at separate points');
 const result={wide:initial,navCollapsed,bothCollapsed,narrowCollapsed,narrowExpanded,readerBefore,readerAfter,nativeNarrow,liveEditorPreserved:true,realSseRefresh:true,historyAnchorPreserved:true,latestFollow:true,persistedPreferences:true,storageFailureTolerated:true,nativeReaderBounds:true,roadmap};
 if(output)writeFileSync(join(output,'layout-result.json'),JSON.stringify(result,null,2));
 console.log('LAYOUT_SMOKE_OK '+JSON.stringify(result));
};
