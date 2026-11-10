const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
exports.run=async(main,base)=>{
 main.showInactive();const exec=async code=>{try{return await main.webContents.executeJavaScript(code);}catch(error){throw Error(error.message+'; fixture JS: '+code.slice(0,300));}},post=(path,body)=>exec(`fetch('/api/${path}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error);return v})`);
 let requests=0,error='',releaseReasoning,releaseReply;
 const until=async(check,label)=>{for(let i=0;i<400;i++){if(await check())return;await new Promise(r=>setTimeout(r,75));}throw Error('Feedback timed out: '+label+' '+error);};
 const mock=createServer(async(req,res)=>{try{
  let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);requests++;
  assert.ok(body.tools.some(t=>t.name==='web_search'));assert.ok(body.tools.some(t=>t.name==='web_fetch'));assert.ok(!body.tools.some(t=>/bash|pwsh|read_file/.test(t.name)));
  const boundary=body.messages.findLastIndex(m=>m.role==='user'&&JSON.stringify(m.content).includes('你是 AI Teacher 的'));
  const used=body.messages.slice(boundary+1).flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(c=>c.type==='tool_use');const name=['mcp__teacher_job__teacher_get_context','web_search','mcp__teacher_job__teacher_reply'][used.length];
  const input=name==='web_search'?{queries:['Python official documentation']}:name?.endsWith('teacher_reply')?{content:'这是实际生成中的回复正文。余下内容完成。'}:{};
  res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
  emit('message_start',{message:{id:'m'+requests,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:10,output_tokens:0}}});
  let index=0;
  if(!used.length){emit('content_block_start',{index,content_block:{type:'thinking',thinking:''}});emit('content_block_delta',{index,delta:{type:'thinking_delta',thinking:'PRIVATE_REASONING_SENTINEL'}});await new Promise(r=>{releaseReasoning=r;res.once('close',r);});if(res.destroyed)return;emit('content_block_stop',{index});index++;}
  emit('content_block_start',{index,content_block:name?{type:'tool_use',id:'c'+requests,name,input:{}}:{type:'text',text:''}});
  if(name?.endsWith('teacher_reply')){const json=JSON.stringify(input),split=json.indexOf('余下');emit('content_block_delta',{index,delta:{type:'input_json_delta',partial_json:json.slice(0,split)}});await new Promise(r=>{releaseReply=r;res.once('close',r);});if(res.destroyed)return;emit('content_block_delta',{index,delta:{type:'input_json_delta',partial_json:json.slice(split)}});}
  else emit('content_block_delta',{index,delta:name?{type:'input_json_delta',partial_json:JSON.stringify(input)}:{type:'text_delta',text:'完成'}});
  emit('content_block_stop',{index});emit('message_delta',{delta:{stop_reason:name?'tool_use':'end_turn'},usage:{output_tokens:10}});emit('message_stop',{});res.end();
 }catch(e){error=e.message;res.destroy();}});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 try{
  const home=process.env.DSH_HOME;assert.ok(home.includes('teacher-desktop-smoke-'));mkdirSync(join(home,'profiles','desktop'),{recursive:true});
  writeFileSync(join(home,'profiles','desktop','cordis.patch.yml'),JSON.stringify([{id:'agent-default-model',config:{provider:'feedback',model:'test'}},{id:'llm-pi-ai',config:{providers:{feedback:{api:'anthropic-messages',baseURL:'http://127.0.0.1:'+mock.address().port,apiKeyEnv:'TEACHER_DSH_TEST_KEY',models:[{id:'test',contextWindow:65536,maxTokens:1024}]}}}},{id:'web-search-deepseek',config:{apiKeyEnv:'TEACHER_TEST_MISSING_SEARCH_KEY'}}]));
  await post('agents/configure',{role:'onboarding',mode:'MCP',harness:'MANUAL'});const intro=await post('study/onboarding',{action:'start',request_id:crypto.randomUUID()});
  const jobs=await exec(`fetch('/api/state').then(r=>r.json()).then(s=>s.jobs.filter(j=>j.conversation_id==='${intro.conversation_id}'&&j.status==='QUEUED'))`);for(const job of jobs)await post('jobs/cancel',{id:job.id});
  await post('agents/configure',{role:'onboarding',mode:'MCP',harness:'DSH'});await main.loadURL(base+'/personal.html?conversation='+intro.conversation_id);await until(()=>exec(`!!document.querySelector('#chat-form.conversation-composer')`),'composer');
  await exec(`document.querySelector('#message').value='每天可以学习三小时';document.querySelector('#message').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));`);assert.equal(requests,0);
  await exec(`document.querySelector('#message').focus()`);main.webContents.focus();main.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter',modifiers:['shift']});main.webContents.sendInputEvent({type:'char',keyCode:'\r',modifiers:['shift']});main.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter',modifiers:['shift']});await until(()=>exec(`document.querySelector('#message').value.includes(String.fromCharCode(10))`),'shift newline');assert.equal(requests,0);
  main.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});main.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
  await until(()=>exec(`document.querySelector('[data-run-progress]')?.textContent.includes('整理思路')`),'actual model signal');assert.equal(await exec(`document.body.textContent.includes('PRIVATE_REASONING_SENTINEL')`),false);
  await main.loadURL(base+'/personal.html?conversation='+intro.conversation_id);await until(()=>exec(`document.querySelector('[data-run-progress]')?.textContent.includes('整理思路')`),'refresh progress snapshot');releaseReasoning();
  await until(()=>exec(`document.querySelector('[data-run-progress]')?.textContent.includes('搜索服务缺少凭据')`),'actual search failure');
  await until(()=>exec(`document.querySelector('[data-reply-preview]')?.textContent.includes('实际生成中')`),'live reply');
  assert.equal((await exec(`fetch('/api/messages?conversation_id=${intro.conversation_id}').then(r=>r.json()).then(rows=>rows.filter(r=>r.role==='assistant').length)`)),0);
  await exec(`document.querySelector('[data-stop-progress]').click()`);await until(()=>exec(`document.querySelector('[data-run-progress]')?.textContent.includes('已取消')`),'cancel feedback');releaseReply?.();
  assert.equal((await fetch(base+'/api/run-progress')).status,401);
  const snapshot=await exec(`fetch('/api/run-progress').then(r=>r.json())`);assert.equal(snapshot.at(-1).status,'CANCELLED');assert.ok(!JSON.stringify(snapshot).includes('PRIVATE_REASONING_SENTINEL'));
  const result={personalEnterSends:true,shiftEnterNewline:true,imeConfirmationNotSent:true,actualReasoningSignal:true,noReasoningTextExposed:true,toolResultsVisible:true,searchCredentialFailureVisible:true,refreshResumes:true,partialReply:true,cancelVisible:true,webToolsAvailable:true,privateSnapshots:true,requests};
  if(process.env.TEACHER_SMOKE_OUTPUT){writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,'feedback-result.json'),JSON.stringify(result,null,2));try{writeFileSync(join(process.env.TEACHER_SMOKE_OUTPUT,'feedback.png'),(await main.webContents.capturePage()).toPNG());}catch{}}
  console.log('FEEDBACK_SMOKE_OK '+JSON.stringify(result));
 }finally{releaseReasoning?.();releaseReply?.();mock.closeAllConnections();await new Promise(r=>mock.close(r));}
};
