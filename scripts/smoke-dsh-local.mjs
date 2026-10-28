// Real DSH + real stdio MCP, with a loopback-only deterministic model endpoint.
// No account key, paid inference, or existing learning database is used.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {probeDshRegistry} from '../server/dsh-model-directory.mjs';
const {startServer}=await import(process.env.TEACHER_DSH_APP_ROOT?pathToFileURL(join(process.env.TEACHER_DSH_APP_ROOT,'server','index.mjs')).href:new URL('../server/index.mjs',import.meta.url).href);
const {resolveDshModel}=await import(process.env.TEACHER_DSH_APP_ROOT?pathToFileURL(join(process.env.TEACHER_DSH_APP_ROOT,'server','dsh-model.mjs')).href:new URL('../server/dsh-model.mjs',import.meta.url).href);

const pluginMode=process.argv.includes('--plugin');
const executable=process.argv.slice(2).find(arg=>!arg.startsWith('--'))||'';
const requestedModels=[];
const dir=mkdtempSync(join(tmpdir(),'teacher-dsh-local-'));
let streamedBeforeWriteback=false;
let requests=0,tools=[],diagnostics='',app,hold=false,held=false,historySeen=false;const launches=[];
const mock=createServer(async(req,res)=>{
 try{
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);requests++;requestedModels.push(body.model);
  tools=(body.tools||[]).map(tool=>tool.name);
  assert.ok(tools.includes('mcp__teacher_job__teacher_get_context'));
  assert.ok(tools.every(name=>name.startsWith('mcp__teacher_job__')),JSON.stringify(tools));
  if(hold){held=true;return;}
  const boundary=body.messages.findLastIndex(m=>m.role==='user'&&(typeof m.content==='string'?m.content.includes('你是 AI Teacher 的'):(m.content||[]).some(c=>c.type==='text'&&c.text?.includes('你是 AI Teacher 的'))));
  if(boundary>0&&JSON.stringify(body.messages.slice(0,boundary)).includes('DSH 本机 MCP 联调通过'))historySeen=true;
  const used=body.messages.slice(boundary+1).flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(c=>c.type==='tool_use');
  const name=used.length===0?'teacher_get_context':used.length===1?'teacher_reply':null;
  const block=name?{type:'tool_use',id:'call_'+requests,name:'mcp__teacher_job__'+name,input:name==='teacher_reply'?{content:'DSH 本机 MCP 联调通过'}:{}}:{type:'text',text:'完成'};
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const event=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
  event('message_start',{message:{id:'msg_'+requests,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}});
  event('content_block_start',{index:0,content_block:block.type==='tool_use'?{...block,input:{}}:{type:'text',text:''}});
  if(name==='teacher_reply'&&!streamedBeforeWriteback){
   const raw=JSON.stringify(block.input),cut=raw.indexOf('MCP');
   event('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:raw.slice(0,cut)}});
   let preview;for(let i=0;i<80;i++){preview=app.harnessDriver.replyStreams().find(r=>r.content==='DSH 本机 ');if(preview)break;await new Promise(r=>setTimeout(r,50));}
   assert.ok(preview,'reply prefix must arrive while the provider is still paused before its remaining tokens');
   assert.equal(app.store.db.prepare('SELECT status FROM jobs WHERE id=?').get(preview.job_id).status,'RUNNING');
   assert.equal(app.store.messages(preview.conversation_id).filter(m=>m.role==='assistant').length,0,'partial preview is not a saved reply');
   streamedBeforeWriteback=true;
   event('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:raw.slice(cut)}});
  }else event('content_block_delta',{index:0,delta:name?{type:'input_json_delta',partial_json:JSON.stringify(block.input)}:{type:'text_delta',text:block.text}});
  event('content_block_stop',{index:0});event('message_delta',{delta:{stop_reason:name?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:10}});event('message_stop',{});res.end();
 }catch(error){diagnostics=error.message;res.writeHead(500);res.end('local smoke assertion failed');}
});
try{
 mock.listen(0,'127.0.0.1');await once(mock,'listening');
 const overlay=join(dir,'mock.json');
 const modelHome=join(dir,'dsh');mkdirSync(join(modelHome,'profiles','desktop'),{recursive:true});
 writeFileSync(join(modelHome,'profiles','desktop','cordis.patch.yml'),JSON.stringify([{id:'agent-default-model',config:{provider:'mock-desktop',model:'local-study-model'}},{id:'llm-pi-ai',config:{providers:{'mock-desktop':{api:'anthropic-messages',baseURL:'http://127.0.0.1:'+mock.address().port,apiKeyEnv:'TEACHER_DSH_TEST_KEY',models:[{id:'local-study-model',contextWindow:65536,maxTokens:1024},{id:'alternate-study-model',contextWindow:65536,maxTokens:1024}]}}}}]));
 if(pluginMode){
  const profile=join(modelHome,'profiles','desktop'),plugin=join(profile,'node_modules','teacher-fixture-provider');mkdirSync(plugin,{recursive:true});
  const provider=JSON.parse(readFileSync(join(profile,'cordis.patch.yml'),'utf8'))[1].config;
  writeFileSync(join(profile,'cordis.patch.yml'),JSON.stringify([{id:'agent-default-model',config:{provider:'mock-desktop',model:'local-study-model'}}]));
  writeFileSync(join(profile,'package.json'),JSON.stringify({dsh:{profile:{bundles:['teacher-fixture-provider']}}}));
  writeFileSync(join(plugin,'package.json'),JSON.stringify({name:'teacher-fixture-provider',type:'module',main:'index.mjs',dsh:{bundle:{patch:'cordis.patch.yml'}}}));
  writeFileSync(join(plugin,'cordis.patch.yml'),JSON.stringify([{insert:[{id:'llm-fixture-provider',name:'teacher-fixture-provider',config:provider}]}]));
  writeFileSync(join(plugin,'index.mjs'),"import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';const pi=await import(pathToFileURL(createRequire(process.argv[1]).resolve('@deepseek-ai/dsh-llm-pi-ai')).href);export const inject=['llm'];export async function apply(ctx,config){const modelRegistry=new Proxy(ctx.llm,{get(target,key){if(key==='registerConfigurableProviders')return ()=>({replace(){}});return Reflect.get(target,key);}});await ctx.plugin({name:'fixture-model-adapter',Config:pi.Config,inject:['llm'],apply(c,cfg){return pi.apply(new Proxy(c,{get(target,key){return key==='llm'?modelRegistry:Reflect.get(target,key);}}),cfg);}},config);}");
 }
 writeFileSync(overlay,JSON.stringify([{id:'llm-retry',disabled:true}]));
 const openApp=()=>startServer({port:0,dataDir:join(dir,'teacher'),executorOptions:{intervalMs:1e9},hostOptions:{intervalMs:1e9},harnessOptions:{intervalMs:1e9,timeoutMs:45000,dshSourceHome:modelHome,...(!pluginMode?{readDshModel:route=>resolveDshModel(route,{home:modelHome})}:{modelDirectoryOptions:{probe:options=>probeDshRegistry({...options,spawnProcess:(command,args,opts)=>spawn(command,args,{...opts,env:{...opts.env,TEACHER_DSH_TEST_KEY:'local-test-key'}})})}}),spawnProcess:(command,args,options)=>{
  launches.push({cwd:options.cwd,home:options.env.DSH_HOME,sessionId:args.includes('--session-id')?args[args.indexOf('--session-id')+1]:null});
  const index=args.includes('--session-id')?args.indexOf('--session-id'):args.indexOf('--json');args.splice(index,0,'--patch',overlay);
  if(pluginMode){const launchPatch=JSON.parse(readFileSync(args[args.indexOf('--patch')+1],'utf8'));const registry=launchPatch.flatMap(r=>r.insert||[]).find(r=>r.id==='teacher-model-registry');assert.equal(registry?.config.plugins.length,1,'plugin execution must load its discovered owner');}
  const child=spawn(command,args,{...options,env:{...options.env,DSH_TELEMETRY_DISABLED:'1',TEACHER_DSH_TEST_KEY:'local-test-key'}});
  // Only this isolated test captures diagnostics; the normal driver discards them.
  child.stderr.on('data',data=>{diagnostics+=data.toString().slice(0,4000);});child.stdout.on('data',data=>{for(const line of data.toString().split('\n'))try{const e=JSON.parse(line);if(e.type==='error'||e.type==='status'&&e.phase==='turn_end')diagnostics+=JSON.stringify(e);}catch{}});return child;
 }}});
 app=openApp();
 await once(app.server,'listening');
 app.store.agents.configure({role:'onboarding',mode:'MCP',harness:'DSH',executable});
 const intro=app.store.study.onboarding({action:'start',request_id:'dsh-local-smoke'});app.harnessDriver.tick();
 let run;
 for(let attempt=0;attempt<480;attempt++){
  run=app.store.db.prepare('SELECT status,error,tool_calls FROM harness_runs ORDER BY rowid DESC LIMIT 1').get();
  if(run&&run.status!=='RUNNING')break;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.equal(run?.status,'COMPLETED',JSON.stringify({run,requests,diagnostics,...pluginMode?{catalog:app.store.agents.dshModels.catalog()}: {}}));
 assert.equal(app.store.messages(intro.conversation_id).at(-1).content,'DSH 本机 MCP 联调通过');
 assert.ok(run.tool_calls>=2);assert.ok(requests>=2);
 const binding=app.store.agents.dshSessions.get(intro.conversation_id);assert.equal(binding.state,'READY',JSON.stringify({binding,diagnostics}));assert.ok(binding.session_id);
 const cid=intro.conversation_id,originalSession=binding.session_id;
 const waitRun=async(jobId)=>{let record;for(let i=0;i<480;i++){record=app.store.db.prepare('SELECT status,error,tool_calls FROM harness_runs WHERE job_id=? ORDER BY rowid DESC LIMIT 1').get(jobId);if(record&&record.status!=='RUNNING')break;await new Promise(r=>setTimeout(r,100));}assert.equal(record?.status,'COMPLETED',JSON.stringify({record,diagnostics}));return record;};
 const queue=text=>{const sent=app.store.send(cid,text,crypto.randomUUID());app.store.models.tag(sent.job_id);app.harnessDriver.tick();return sent.job_id;};
 const switchIndex=requestedModels.length;app.store.agents.dshModels.save(cid,'mock-desktop/alternate-study-model');await waitRun(queue('第二轮，请沿用本段对话。'));assert.ok(requestedModels.slice(switchIndex).every(m=>m==='alternate-study-model'),'resumed DSH must actually request the newly selected model');assert.equal(app.store.agents.dshSessions.get(cid).session_id,originalSession);assert.equal(launches[1].sessionId,originalSession);assert.equal(launches[1].cwd,launches[0].cwd);assert.ok(historySeen,'DSH must retain earlier durable messages');
 await app.close();app=openApp();await once(app.server,'listening');
 await waitRun(queue('第三轮，重启后继续。'));assert.equal(app.store.agents.dshSessions.get(cid).session_id,originalSession);assert.equal(launches[2].sessionId,originalSession);
 writeFileSync(join(binding.cwd,'shared-workspace-check.txt'),'shared by AI Teacher conversations');
 app.store.agents.configure({role:'master',mode:'MCP',harness:'DSH',executable});const other=app.store.agents.conversation();const sent=app.store.send(other.conversation_id,'独立对话测试',crypto.randomUUID());app.store.models.tag(sent.job_id);app.harnessDriver.tick();await waitRun(sent.job_id);
 const separate=app.store.agents.dshSessions.get(other.conversation_id);assert.notEqual(separate.session_id,originalSession);assert.equal(separate.cwd,binding.cwd);assert.notEqual(launches[3].home,launches[0].home);
 assert.equal(readFileSync(join(launches[3].cwd,'shared-workspace-check.txt'),'utf8'),'shared by AI Teacher conversations');
 hold=true;const interrupted=queue('中断后重试同一条消息。');for(let i=0;i<150&&!held;i++)await new Promise(r=>setTimeout(r,100));assert.ok(held);await app.close();hold=false;
 app=openApp();await once(app.server,'listening');assert.equal(app.store.agents.dshSessions.get(cid).session_id,originalSession);app.store.agents.retry({job_id:interrupted});app.harnessDriver.tick();await waitRun(interrupted);assert.equal(app.store.agents.dshSessions.get(cid).session_id,originalSession);
 const current=app.store.agents.dshSessions.get(cid),paths=app.store.agents.dshSessions.paths(current,join(dir,'teacher'));rmSync(join(paths.home,current.log_path));
 assert.equal(app.harnessDriver.checkSession({conversation_id:cid}).state,'RECOVERY_REQUIRED');assert.equal(app.harnessDriver.checkSession({conversation_id:cid,restore:true}).state,'READY');
 await waitRun(queue('检查点恢复后继续。'));assert.equal(app.store.agents.dshSessions.get(cid).session_id,originalSession);
 const oldLog=join(paths.home,app.store.agents.dshSessions.get(cid).log_path);app.harnessDriver.resetSession({conversation_id:cid});await waitRun(queue('明确重建会话后从站内历史继续。'));
 assert.notEqual(app.store.agents.dshSessions.get(cid).session_id,originalSession);assert.ok(existsSync(oldLog));assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM dsh_session_history WHERE conversation_id=?').get(cid).n,1);
 console.log(JSON.stringify({harness:'DSH',pluginProvider:pluginMode,streamedBeforeWriteback,automaticDetection:!executable,desktopModelInherited:true,sameSessionModelSwitch:true,sameConversationReused:true,restartResumed:true,sharedWorkspace:true,interruptedRetryResumed:true,checkpointRestored:true,explicitRebuildPreservesHistory:true,requests,onlyTeacherTools:tools.every(name=>name.startsWith('mcp__teacher_job__')),assistantReply:true},null,2));
}finally{
 await app?.close();mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));rmSync(dir,{recursive:true,force:true});
}
