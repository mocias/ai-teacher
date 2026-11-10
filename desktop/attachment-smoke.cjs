const assert=require('node:assert/strict');
const {mkdtempSync,writeFileSync,rmSync,mkdirSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');

// Run only against the smoke runner's isolated data/profile. CDP supplies actual
// local file paths to Chromium; an Explorer desktop drag remains a separate check.
exports.run=async(main,base)=>{
 assert.match(process.env.TEACHER_DATA_DIR||'',/teacher-desktop-smoke-/,'attachment smoke requires isolated data');
 const exec=code=>main.webContents.executeJavaScript(code);
 const until=async(check,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,80));}throw Error('Attachment smoke timed out: '+label);};
 const post=(path,body)=>exec(`fetch('/api/${path}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error);return v;})`);
 const read=path=>exec(`fetch(${JSON.stringify('/api/'+path)}).then(async r=>{if(!r.ok)throw Error(await r.text());return r.json();})`);
 const click=selector=>exec(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const draft=(selector,text)=>exec(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const pending=()=>exec(`Number(document.querySelector('#composer,#discovery-composer')?.dataset.attachmentCount||0)`);
 const messages=cid=>read('messages?conversation_id='+encodeURIComponent(cid));
 const work=mkdtempSync(join(tmpdir(),'teacher-attachment-files-'));
 const md=join(work,'附件学习.md'),second=join(work,'第二份.md'),binary=join(work,'原始资料.pdf');
 const content='# 附件验证\n\n缓存键必须包含请求上下文。ATTACHMENT_NATIVE_CONTEXT';
 writeFileSync(md,content);writeFileSync(second,'# 另一个对话的独立草稿');writeFileSync(binary,'%PDF-1.4 unsupported fixture');
 const debuggerApi=main.webContents.debugger,ownedDebugger=!debuggerApi.isAttached();
 if(ownedDebugger)debuggerApi.attach('1.3');
 const command=(name,args)=>debuggerApi.sendCommand(name,args);
 const picker=async paths=>{const {root}=await command('DOM.getDocument',{});const {nodeId}=await command('DOM.querySelector',{nodeId:root.nodeId,selector:'[data-attachment-input]'});assert.ok(nodeId);await command('DOM.setFileInputFiles',{nodeId,files:paths});};
 const drag=async(path,selector)=>{
  const point=await exec(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+Math.min(r.height/2,70)};})()`);
  const data={items:[],files:[path],dragOperationsMask:1};
  for(const type of ['dragEnter','dragOver','drop'])await command('Input.dispatchDragEvent',{type,...point,data});
 };
 try{
  await post('models/enabled',{enabled:false});await post('host/settings',{enabled:false});
  await post('agents/configure',{role:'chat',mode:'MCP',harness:'MANUAL'});
  const {token}=await post('agents/token',{role:'chat'});
  const goal=await post('goals',{title:'附件隔离验收',domain:'隔离测试',scope:'拖入资料与消息留存'});
  const c1=goal.conversation.id,c2=(await post('conversations',{goal_id:goal.goal.id,title:'独立附件草稿'})).id;
  const before=await read('state');
  await main.loadURL(base+'/?view=chat&goal_id='+goal.goal.id+'&conversation_id='+c1);
  await until(()=>exec(`!!document.querySelector('[data-attachment-input]')`),'teacher composer');
  const startingURL=main.webContents.getURL();
  await drag(md,'.messages');await until(async()=>await pending()===1,'file-path drag into transcript');
  assert.equal(main.webContents.getURL(),startingURL,'file drop must not navigate to local file');
  assert.equal((await messages(c1)).length,0,'drop must not send automatically');
  await draft('#message-input','请结合附件讨论缓存键');
  await click(`[data-chat="${c2}"]`);await until(()=>exec(`document.querySelector('[data-chat="${c2}"]')?.getAttribute('aria-current')==='true'`),'second conversation');
  assert.equal(await pending(),0);await picker([second]);await until(async()=>await pending()===1,'picker queue');
  await draft('#message-input','第二个对话独立草稿');
  await click(`[data-chat="${c1}"]`);await until(()=>exec(`document.querySelector('#message-input')?.value==='请结合附件讨论缓存键'`),'first draft restored');assert.equal(await pending(),1);
  // A successful server commit followed by a lost response exercises the real
  // idempotent retry path rather than replacing server persistence with a mock.
  await exec(`window.attachmentSmokeFetch=window.fetch;window.attachmentSmokeRequests=[];window.attachmentSmokeLose=true;window.fetch=async(url,options)=>{if(url==='/api/messages'&&options?.method==='POST'){attachmentSmokeRequests.push(JSON.parse(options.body));const response=await attachmentSmokeFetch(url,options);if(attachmentSmokeLose){attachmentSmokeLose=false;throw Error('附件验收：响应丢失');}return response;}return attachmentSmokeFetch(url,options);};document.querySelector('#composer button[type=submit]').click();true`);
  await until(()=>exec(`!document.querySelector('#composer button[type=submit]').disabled&&document.querySelector('#toast').textContent.includes('响应丢失')`),'lost response retained draft');
  assert.equal(await pending(),1);assert.equal(await exec(`document.querySelector('#message-input').value`),'请结合附件讨论缓存键');
  assert.equal((await messages(c1)).filter(message=>message.role==='user').length,1);
  await click('#composer button[type=submit]');await until(async()=>await pending()===0,'same-request retry');
  const requests=await exec('attachmentSmokeRequests');assert.equal(requests.length,2);assert.equal(requests[0].request_id,requests[1].request_id);assert.deepEqual(requests[0].attachment_resource_ids,requests[1].attachment_resource_ids);
  await exec('window.fetch=attachmentSmokeFetch;delete window.attachmentSmokeFetch;true');
  const history=await messages(c1),sent=history.filter(message=>message.role==='user');assert.equal(sent.length,1);assert.equal(sent[0].attachments.length,1);assert.equal(sent[0].attachments[0].name,'附件学习.md');
  const agentTool=(name,args)=>exec(`fetch('/api/agents/tool',{method:'POST',headers:{Authorization:'Bearer '+${JSON.stringify(token)},'Content-Type':'application/json'},body:JSON.stringify({role:'chat',name:${JSON.stringify(name)},arguments:${JSON.stringify(args)}})}).then(async response=>{const value=await response.json();if(!response.ok)throw Error(value.error);return value;})`);
  const claimed=await agentTool('teacher_claim_message',{conversation_id:c1});assert.ok(claimed.job,'manual host claims saved attachment message');
  const contextResponse=await agentTool('teacher_get_context',{job_id:claimed.job.id,lease_token:claimed.job.lease_token});
  assert.match(JSON.stringify(contextResponse),/ATTACHMENT_NATIVE_CONTEXT/,'real host context must include extracted attachment text');
  const original=await exec(`fetch(${JSON.stringify(sent[0].attachments[0].download_url)}).then(response=>{if(!response.ok)throw Error('download failed');return response.text();})`);assert.equal(original,content);
  await until(()=>exec(`document.querySelector('.message-attachment')?.textContent.includes('附件学习.md')`),'persistent message file chip');
  assert.equal(await exec(`document.querySelector('.message-attachment a').getAttribute('href')`),'/api/resource-file?id='+encodeURIComponent(sent[0].attachments[0].resource_id));
  await click(`[data-chat="${c2}"]`);await until(()=>exec(`document.querySelector('#message-input')?.value==='第二个对话独立草稿'`),'other draft retained after successful send');assert.equal(await pending(),1);
  await main.loadURL(base+'/?view=chat&goal_id='+goal.goal.id+'&conversation_id='+c1);await until(()=>exec(`!!document.querySelector('.message-attachment')`),'history survives reload');assert.equal(await pending(),0);
  // The same picker/queue path also operates in home discovery, including a
  // file-only send and truthful presentation of unsupported binary formats.
  const discussion=await post('discussions',{request_id:crypto.randomUUID()});
  await exec(`localStorage.setItem('teacher-discussion',${JSON.stringify(discussion.conversation_id)});true`);await main.loadURL(base+'/?home_chat=discovery');
  await until(()=>exec(`!!document.querySelector('#discovery-composer [data-attachment-input]')`),'discovery attachments');
  await picker([binary]);await until(async()=>await pending()===1,'discovery picker');
  await click('#discovery-composer button[type=submit]');await until(async()=>await pending()===0&&(await messages(discussion.conversation_id)).some(message=>message.attachments?.length),'discovery file-only saved');
  await until(()=>exec(`document.querySelector('.message-attachment')?.textContent.includes('原始资料.pdf')`),'discovery binary chip');
  const discoveryMessages=await messages(discussion.conversation_id);assert.equal(discoveryMessages.at(-1).attachments[0].content_status,'UNAVAILABLE');
  assert.ok(await exec(`document.querySelector('.message-attachment').textContent.includes('文件格式')||document.querySelector('.message-attachment').textContent.includes('未提取')`));
  const after=await read('state');assert.deepEqual(after.goal_resources,before.goal_resources,'attachment send must not link formal learning resources');assert.ok(after.resources.filter(resource=>[sent[0].attachments[0].resource_id,discoveryMessages.at(-1).attachments[0].resource_id].includes(resource.id)).every(resource=>!resource.goal_id));
  assert.equal(after.models.enabled,false);assert.equal(after.agents.runs.length,before.agents.runs.length,'attachments must not launch external agents');
  const result={chromiumLocalFileDrag:true,picker:true,noAutoSend:true,perConversationDrafts:true,responseLossRetry:true,oneMessageOneUpload:true,hostContext:true,originalDownload:true,reloadPersisted:true,discoveryFileOnly:true,binaryTruthful:true,noGoalLinks:true,externalModelsDisabled:true,explorerDesktopDrag:'separate manual acceptance'};
  if(process.env.TEACHER_SMOKE_OUTPUT){mkdirSync(process.env.TEACHER_SMOKE_OUTPUT,{recursive:true});writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,'attachment-result.json'),JSON.stringify(result,null,2));writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,'attachment-discovery.png'),(await main.webContents.capturePage()).toPNG());}
  console.log('ATTACHMENT_SMOKE_OK '+JSON.stringify(result));return result;
 }finally{
  try{await exec(`if(window.attachmentSmokeFetch)window.fetch=window.attachmentSmokeFetch;true`);}catch{}
  if(ownedDebugger&&debuggerApi.isAttached())debuggerApi.detach();rmSync(work,{recursive:true,force:true});
 }
};
