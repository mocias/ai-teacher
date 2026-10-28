const assert=require('node:assert/strict');
const http=require('node:http');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
exports.run=async(main,base)=>{
 main.showInactive();const exec=code=>main.webContents.executeJavaScript(code);
 const until=async(check,label)=>{for(let i=0;i<350;i++){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw Error('Streaming timed out: '+label+' '+JSON.stringify({requests,modelError}));};
 const post=(path,body)=>exec(`fetch('/api/${path}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error);return v})`);
 const modelsSeen=[];
 let requests=0,modelError='',mode='normal',releaseFirst,releaseSecond,providerFinished=false;
 const prefix='## 实时回复\n\n第一段正在生成。',middle='第二段继续补充。',tail='最后一段已经完成。';
 const mock=http.createServer(async(req,res)=>{
  try{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests++;modelsSeen.push(body.model);
   assert.ok(body.tools.every(t=>t.name.startsWith('mcp__teacher_job__')));
   const boundary=body.messages.findLastIndex(m=>m.role==='user'&&JSON.stringify(m.content).includes('你是 AI Teacher 的'));
   const used=body.messages.slice(boundary+1).flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(c=>c.type==='tool_use');
   const name=used.length===0?'teacher_get_context':used.length===1?'teacher_reply':null;
   const event=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   event('message_start',{message:{id:'m'+requests,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}});
   event('content_block_start',{index:0,content_block:name?{type:'tool_use',id:'call'+requests,name:'mcp__teacher_job__'+name,input:{}}:{type:'text',text:''}});
   if(name==='teacher_reply'){
    const content=mode==='cancel'?'取消测试的半段正文，余下内容不应保存。':prefix+middle+tail,json=JSON.stringify({content});
    const cut=mode==='cancel'?json.indexOf('余下'):json.indexOf('第二段'),cut2=mode==='cancel'?json.length:json.indexOf('最后');
    event('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:json.slice(0,cut)}});
    await new Promise(r=>{releaseFirst=r;res.once('close',r);});
    if(res.destroyed)return;
    event('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:json.slice(cut,cut2)}});
    if(mode!=='cancel'){await new Promise(r=>{releaseSecond=r;res.once('close',r);});if(res.destroyed)return;}
    event('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:json.slice(cut2)}});providerFinished=true;
   }else event('content_block_delta',{index:0,delta:name?{type:'input_json_delta',partial_json:'{}'}:{type:'text_delta',text:'完成'}});
   event('content_block_stop',{index:0});event('message_delta',{delta:{stop_reason:name?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:10}});event('message_stop',{});res.end();
  }catch(error){modelError=error.message;res.destroy();}
 });
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 try{
  const home=process.env.DSH_HOME;assert.ok(home.includes('teacher-desktop-smoke-'),'must use isolated DSH config');mkdirSync(join(home,'profiles','desktop'),{recursive:true});
  writeFileSync(join(home,'profiles','desktop','cordis.patch.yml'),JSON.stringify([{id:'agent-default-model',config:{provider:'local-stream',model:'local-model'}},{id:'llm-pi-ai',config:{providers:{'local-stream':{api:'anthropic-messages',baseURL:'http://127.0.0.1:'+mock.address().port,apiKeyEnv:'TEACHER_DSH_TEST_KEY',models:[{id:'local-model',contextWindow:65536,maxTokens:1024}]},'local-other':{api:'anthropic-messages',baseURL:'http://127.0.0.1:'+mock.address().port,apiKeyEnv:'TEACHER_DSH_TEST_KEY',models:[{id:'smart/alternate',contextWindow:65536,maxTokens:1024}]}}}}]));
  await post('agents/configure',{role:'master',mode:'MCP',harness:'DSH'});const {conversation_id:cid}=await post('agents/conversation',{});
  await main.loadURL(base+'/agents.html');await until(()=>exec(`!!document.querySelector('#content')&&!document.querySelector('#send').disabled`),'chat ready');
  await until(()=>exec(`!!document.querySelector('.dsh-model-picker select option[value="local-other/smart/alternate"]')`),'DSH model catalog loaded');
  const choose=async value=>{await exec(`(()=>{const select=document.querySelector('.dsh-model-picker select');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await until(()=>exec(`!!document.querySelector('.dsh-model-picker select:not(:disabled)')&&document.querySelector('.dsh-model-picker select').value===${JSON.stringify(value)}`),'model selection saved');};
  await choose('local-other/smart/alternate');
  await exec(`document.querySelector('#content').value='验证真正的实时回复';document.querySelector('#agent-chat').requestSubmit()`);
  await until(()=>exec(`document.querySelector('[data-reply-preview]')?.textContent.includes('第一段正在生成。')`),'prefix visible before remaining tokens');
  assert.ok(modelsSeen.length>0&&modelsSeen.every(model=>model==='smart/alternate'),'provider/model selection must reach the actual DSH request');
  await choose('local-stream/local-model');
  const activeModel=await exec(`fetch('/api/state').then(r=>r.json()).then(s=>s.agents.runs.find(r=>r.status==='RUNNING'))`);assert.equal(activeModel.model_name,'smart/alternate','switching preferences must not change an active run');
  assert.equal(providerFinished,false);assert.equal(await exec(`document.querySelector('#messages').textContent.includes('第二段')`),false);
  let messages=await exec(`fetch('/api/messages?conversation_id=${cid}').then(r=>r.json())`);assert.equal(messages.filter(m=>m.role==='assistant').length,0);
  const snapshot=await exec(`fetch('/api/reply-streams').then(r=>r.json())`);assert.equal(snapshot[0].status,'GENERATING');
  // Reload destroys both EventSources; the replacement page must receive a real snapshot.
  await main.webContents.reload();await until(()=>exec(`document.querySelector('[data-reply-preview]')?.textContent.includes('第一段正在生成。')`),'reload restores partial snapshot');assert.equal(providerFinished,false);
  releaseFirst();await until(()=>exec(`document.querySelector('[data-reply-preview]')?.textContent.includes('第二段继续补充。')`),'second fragment visible while final held');assert.equal(providerFinished,false);
  if(process.env.TEACHER_SMOKE_OUTPUT)writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,'streaming-partial.png'),(await main.webContents.capturePage()).toPNG());
  releaseSecond();await until(()=>exec(`document.querySelector('#messages').textContent.includes('最后一段已经完成。')&&!document.querySelector('[data-reply-preview]')`),'authoritative reply replaces preview');
  messages=await exec(`fetch('/api/messages?conversation_id=${cid}').then(r=>r.json())`);assert.equal(messages.filter(m=>m.role==='assistant').length,1);assert.equal(messages.at(-1).content,prefix+middle+tail);
  const beforeNext=modelsSeen.length;
  mode='cancel';releaseFirst=null;await exec(`document.querySelector('#content').value='取消流式生成测试';document.querySelector('#agent-chat').requestSubmit()`);
  await until(()=>exec(`document.querySelector('[data-reply-preview]')?.textContent.includes('取消测试的半段')`),'next turn preview');
  assert.ok(modelsSeen.slice(beforeNext).every(model=>model==='local-model'),'next turn must use the new selection');
  const sessions=await exec(`fetch('/api/state').then(r=>r.json()).then(s=>s.agents.runs.filter(r=>r.dsh_session_id).map(r=>r.dsh_session_id))`);assert.ok(sessions.length>=2&&new Set(sessions).size===1,'switching models must reuse the same DSH session');
  const pending=await exec(`fetch('/api/state').then(r=>r.json()).then(s=>s.jobs.find(j=>j.conversation_id==='${cid}'&&j.status==='RUNNING'))`);assert.ok(pending);
  await post('jobs/cancel',{id:pending.id});await until(()=>exec(`document.querySelector('[data-reply-preview]')?.textContent.includes('已取消')`),'cancel marks partial unsaved');releaseFirst?.();
  assert.equal((await exec(`fetch('/api/messages?conversation_id=${cid}').then(r=>r.json())`)).filter(m=>m.role==='assistant').length,1);
  assert.equal((await fetch(base+'/api/reply-streams')).status,401,'snapshots require browser session');
  const result={conversationModelPicker:true,providerSwitchReachesDsh:true,runningModelFrozen:true,nextMessageUsesSelection:true,sameSessionPreserved:true,realInstalledDsh:true,visibleBeforeProviderFinishes:true,multipleLiveFragments:true,reloadResumesSnapshot:true,savedExactlyOnce:true,cancelledPartialNotSaved:true,privateSnapshotEndpoint:true,requests};
  if(process.env.TEACHER_SMOKE_OUTPUT)writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,'streaming-result.json'),JSON.stringify(result,null,2));
  console.log('STREAMING_SMOKE_OK '+JSON.stringify(result));
 }finally{releaseFirst?.();releaseSecond?.();mock.closeAllConnections();await new Promise(r=>mock.close(r));}
};
