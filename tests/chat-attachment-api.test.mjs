import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once,EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createStore,id} from '../server/store.mjs';
import {startServer} from '../server/index.mjs';
import {modelExecutor} from '../server/model-executor.mjs';
import {codexHost} from '../server/codex-host.mjs';
import {harnessHost} from '../server/harness-host.mjs';
import {invoke,callJobTool} from '../server/tools.mjs';
import {createChatAttachments} from '../public/chat-attachments.js';
import {acpMemoryProcess} from './fixtures/acp-memory.mjs';

const save=(s,body='附件正文：缓存可以复用。',name='学习.md',request_id)=>s.resource({file:{name,base64:Buffer.from(body).toString('base64')},request_id});
function chats(s){const goal=s.createGoal({title:'学习缓存',domain:'推理',scope:'解释复用'});const p=s.propose({goal_id:goal.goal.id,title:'已有路线',summary:'学习原理',items:[{title:'缓存原理',objective:'解释复用'}],request_id:id()});s.decide(p.proposal_id,true);const task=s.overview().sessions[0];return {planning:goal.conversation.id,discovery:s.discovery.create({request_id:id()}).conversation_id,session:s.sessionLearning.open({session_id:task.id,request_id:id()}).conversation_id,goalId:goal.goal.id};}
const count=(s,table)=>s.db.prepare('SELECT count(*) AS n FROM '+table).get().n;

test('response lost after successful resource upload retries the same immutable upload receipt',async t=>{
 const s=createStore(':memory:');t.after(()=>s.db.close());let calls=0;const ids=[];
 const queue=createChatAttachments({readFile:async()=>Buffer.from('重试正文').toString('base64'),api:async(_path,input)=>{ids.push(input.request_id);const saved=s.resource(input);if(++calls===1)throw Error('响应丢失');return saved;}});
 queue.add('c',[{name:'retry.md',size:12}]);await assert.rejects(queue.prepare('c'),/响应丢失/);const result=await queue.prepare('c');assert.equal(result.resource_ids.length,1);assert.equal(ids[0],ids[1]);assert.equal(count(s,'resources'),1);assert.equal(count(s,'resource_files'),1);assert.equal(count(s,'material_contents'),1);
});

test('unsupported, invalid encoding, and oversized text have truthful extraction reasons',t=>{
 const s=createStore(':memory:');t.after(()=>s.db.close());const c=chats(s).planning;
 const binary=save(s,'%PDF','source.pdf'),invalid=save(s,Buffer.from([255,254]),'bad.md'),long=save(s,'字'.repeat(150001),'large.md');s.send(c,'读取附件',id(),undefined,[binary.id,invalid.id,long.id]);
 const [a,b,d]=s.messages(c)[0].attachments;assert.match(a.extraction_reason,/文件格式/);assert.match(b.extraction_reason,/UTF-8/);assert.match(d.extraction_reason,/15 万字/);assert.ok([a,b,d].every(row=>row.content_status==='UNAVAILABLE'));
});

test('attachments persist independently of message text without changing learning state; retries reuse originals',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-chat-files-')),path=join(dir,'teacher.sqlite');let s=createStore(path);t.after(()=>{s.db.close();rmSync(dir,{recursive:true,force:true});});
 const c=chats(s),before=s.overview(),uploadId=id(),resource=save(s,undefined,undefined,uploadId);assert.deepEqual(save(s,undefined,undefined,uploadId),resource);assert.equal(count(s,'resources'),1);
 const binary=save(s,'%PDF-1.4 binary','参考.pdf');const requestId=id(),sent=s.send(c.planning,'请看附件',requestId,undefined,[resource.id,binary.id]);
 assert.deepEqual(s.send(c.planning,'重试不改变原消息',requestId,undefined,[binary.id]),sent);assert.equal(count(s,'message_attachments'),2);assert.equal(s.messages(c.planning)[0].content,'请看附件');
 const metadata=s.messages(c.planning)[0].attachments;assert.equal(metadata[0].content,undefined);assert.equal(metadata[0].content_status,'READABLE');assert.equal(metadata[1].content_status,'UNAVAILABLE');assert.match(metadata[1].unavailable_reason,/未提取/);
 const context=await invoke(s,'teacher_get_context',{conversation_id:c.planning});assert.match(context.messages[0].attachments[0].content,/缓存可以复用/);assert.equal(context.messages[0].attachments[1].content,undefined);
 const after=s.overview();for(const key of ['goals','goal_resources','sessions','evidence','profiles','proposals'])assert.deepEqual(after[key],before[key],key);assert.equal(after.resources[0].goal_id,null);assert.equal(after.resources[0].role,'REFERENCE');
 s.db.close();s=createStore(path);assert.deepEqual(s.messages(c.planning)[0].attachments,metadata);assert.match(s.context(c.planning).messages[0].attachments[0].content,/缓存可以复用/);
});

test('validation rolls back message, job, receipt and association together',t=>{
 const s=createStore(':memory:');t.after(()=>s.db.close());const c=chats(s).planning,r=save(s),before=['messages','jobs','receipts','message_attachments'].map(table=>count(s,table));
 for(const refs of [['missing'],[r.id,r.id],'not-an-array',Array.from({length:6},()=>id())])assert.throws(()=>s.send(c,'看看',id(),undefined,refs));
 assert.deepEqual(['messages','jobs','receipts','message_attachments'].map(table=>count(s,table)),before);
 const link=s.resource({title:'网页',url:'https://example.test'});assert.throws(()=>s.send(c,'看看',id(),undefined,[link.id]),/文件不存在/);
 const a=save(s,Buffer.alloc(11*1024*1024),'a.bin'),b=save(s,Buffer.alloc(11*1024*1024),'b.bin');assert.throws(()=>s.send(c,'看看',id(),undefined,[a.id,b.id]),/20 MB/);
});

test('formal assessments reject attachments without consuming answers; text-only receipt semantics are unchanged',t=>{
 const s=createStore(':memory:');t.after(()=>s.db.close());const g=s.createGoal({title:'缓存',domain:'推理'}),l=s.learning,set=l.proposeCapabilities({goal_id:g.goal.id,items:[{title:'缓存',kind:'CORE',requirements:[{node:'KV',description:'说明复用'}]}],request_id:id()});l.confirmCapabilities({id:set.proposal_id,accept:true});const requirement=l.state(g.goal.id).requirements[0].id;
 const a=l.begin({goal_id:g.goal.id,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',scope:'复用',requirement_ids:[requirement],resource_ids:[],request_id:id()}),job=s.claim('test',a.conversation_id).job;l.question({assessment_id:a.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'为什么复用？',requirement_ids:[requirement],request_id:id()});
 const resource=save(s),before=s.overview(),counts=['messages','jobs','receipts','message_attachments'].map(table=>count(s,table));
 for(const refs of [[resource.id],['missing'],'invalid'])assert.throws(()=>s.send(a.conversation_id,'这是回答',id(),undefined,refs),/正式考察仅接受文字/);
 assert.throws(()=>s.send(a.conversation_id,'这是回答',undefined,undefined,[]),/request_id/);
 assert.deepEqual(s.overview(),before);assert.deepEqual(['messages','jobs','receipts','message_attachments'].map(table=>count(s,table)),counts);assert.equal(l.state(g.goal.id).assessments[0].status,'WAITING_ANSWER');
 const request=id(),answer=s.send(a.conversation_id,'这是文字回答',request,undefined,[]);assert.deepEqual(s.send(a.conversation_id,'重试',request),answer);assert.deepEqual(s.send(a.conversation_id,'重试',request,undefined,[resource.id]),answer);assert.equal(s.messages(a.conversation_id).at(-1).attachments,undefined);assert.equal(count(s,'message_attachments'),0);
});

test('attachment context bounds are explicit and applied after claimed-message cutoff',t=>{
 const s=createStore(':memory:');t.after(()=>s.db.close());const c=chats(s).planning,body='正文'.repeat(10000),r=save(s,body);
 const first=s.send(c,'first',id(),undefined,[r.id]);s.send(c,'second',id(),undefined,[r.id]);s.send(c,'future',id(),undefined,[r.id]);
 const all=s.context(c).messages.map(m=>m.attachments[0]);assert.deepEqual(all.map(a=>a.content.length),[0,12000,12000]);assert.equal(all[0].omitted,true);assert.ok(all.every(a=>a.truncated));
 const claimed=s.claim('manual',c);assert.equal(claimed.job.message_id,first.message_id);assert.equal(claimed.context.messages.length,1);assert.equal(claimed.context.messages[0].attachments[0].content.length,12000);
 assert.match(claimed.context.messages[0].attachments[0].content_note,/不得声称已读全文/);
 for(let n=0;n<2;n++){const repeated=callJobTool(s,claimed.job.id,'teacher_get_context',{conversation_id:c});assert.equal(repeated.messages.length,1);assert.equal(repeated.messages[0].attachments[0].content.length,12000);assert.equal(repeated.messages[0].id,first.message_id);}
});

test('API repeated context tools budget the claimed attachment before later queued files',async t=>{
 const s=createStore(':memory:');t.after(()=>s.db.close());const c=chats(s).discovery,resources=['第一份正文','后排第二份','后排第三份'].map(prefix=>save(s,prefix+'字'.repeat(13000))),p=s.models.save({name:'上下文回归',base_url:'https://example.test/v1',model:'context-test'});s.models.routes({routes:[{module:'chat',profile_id:p.id}]});s.models.enabled(true);
 const sent=resources.map((resource,index)=>s.send(c,'问题'+index,id(),undefined,[resource.id]));let requests=0;
 const executor=modelExecutor(s,{intervalMs:1e9,fetcher:async(_url,options)=>{
  const payload=JSON.parse(options.body),input=JSON.parse(payload.messages.find(message=>message.role==='user').content).context;assert.equal(input.messages.length,1);assert.equal(input.messages[0].id,sent[0].message_id);assert.equal(input.messages[0].attachments[0].content.length,12000);
  for(const message of payload.messages.filter(message=>message.role==='tool')){const context=JSON.parse(message.content);assert.equal(context.messages.length,1);assert.equal(context.messages[0].id,sent[0].message_id);assert.equal(context.messages[0].attachments[0].content.length,12000);assert.match(context.messages[0].attachments[0].content,/第一份正文/);assert.doesNotMatch(message.content,/后排第二份|后排第三份/);}
  requests++;const message=requests<3?{tool_calls:[{id:'context_'+requests,type:'function',function:{name:'teacher_get_context',arguments:'{}'}}]}:{content:'根据第一份附件答复。'};return new Response(JSON.stringify({choices:[{finish_reason:requests<3?'tool_calls':'stop',message}]}));
 }});t.after(()=>executor.stop());await executor.tick();assert.equal(requests,3);assert.equal(s.messages(c).at(-1).content,'根据第一份附件答复。');
});

test('emoji attachment excerpts respect the request budget and keep Unicode characters whole',t=>{
 const s=createStore(':memory:');t.after(()=>s.db.close());const c=chats(s).planning,r=save(s,'😀'.repeat(14000));
 s.send(c,'看看',id(),undefined,[r.id]);s.send(c,'继续',id(),undefined,[r.id]);s.send(c,'最后',id(),undefined,[r.id]);
 const attachments=s.context(c).messages.flatMap(message=>message.attachments);assert.equal(attachments.reduce((sum,a)=>sum+a.content.length,0),24000);assert.ok(attachments.every(a=>a.content.length<=12000));assert.ok(attachments.every(a=>!/[\uD800-\uDBFF]$/.test(a.content)));assert.ok(attachments.every(a=>a.truncated));
});

for(const kind of ['planning','discovery','session'])test(kind+' API model receives readable attachment text and original message',async t=>{
 const s=createStore(':memory:');t.after(()=>s.db.close());const c=chats(s)[kind],r=save(s),p=s.models.save({name:'附件测试',base_url:'https://example.test/v1',model:'chat'});s.models.routes({routes:[{module:'chat',profile_id:p.id}]});s.models.enabled(true);let received=false;
 const executor=modelExecutor(s,{intervalMs:1e9,fetcher:async(_url,options)=>{const context=JSON.parse(JSON.parse(options.body).messages.find(m=>m.role==='user').content).context;assert.equal(context.messages[0].content,'请看附件');assert.match(context.messages[0].attachments[0].content,/缓存可以复用/);received=true;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'看到了附件中的复用说明。'}}]}));}});t.after(()=>executor.stop());
 s.send(c,'请看附件',id(),undefined,[r.id]);await executor.tick();assert.equal(received,true);assert.equal(s.messages(c).at(-1).role,'assistant');
});

for(const harness of ['LEGACY_CODEX','CODEX','DSH'])test(harness+' context tool receives persisted attachment content',async t=>{
 const s=createStore(':memory:'),dir=mkdtempSync(join(tmpdir(),'teacher-file-host-'));let driver,error,finish;const done=new Promise(resolve=>finish=resolve),c=chats(s).session,r=save(s);
 const exercise=token=>{const call=(name,args={})=>harness==='LEGACY_CODEX'?driver.invoke({name,arguments:args,operation_id:id()}):driver.invoke(token,{name,arguments:args,operation_id:id()});
  const context=call('teacher_get_context');assert.match(context.messages[0].attachments[0].content,/缓存可以复用/);call('teacher_reply',{content:'根据附件答疑。'});
 };
 const spawnProcess=(_exe,_args,options)=>{
  if(harness==='DSH')return acpMemoryProcess(options,{onPrompt:({token})=>exercise(token),onComplete:finish,onError:e=>{error=e;finish();}});
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>child.emit('close',1);child.stdin.on('data',()=>{});child.stdin.on('finish',()=>setImmediate(()=>{try{exercise(options.env.TEACHER_HOST_TOKEN);}catch(e){error=e;}finally{child.emit('close',0);finish();}}));return child;
 };
 if(harness==='LEGACY_CODEX'){s.hostConfig.save({enabled:true});driver=codexHost(s,{dataDir:dir,baseUrl:()=>'',spawnProcess,intervalMs:1e9});}
 else{s.agents.configure({role:'chat',mode:'MCP',harness,executable:process.execPath,...(harness==='DSH'?{model:'custom/model'}:{})});driver=harnessHost(s,{dataDir:dir,baseUrl:()=>'',spawnProcess,readDshModel:()=>null,intervalMs:1e9});}
 t.after(async()=>{await driver.stop();s.db.close();rmSync(dir,{recursive:true,force:true});});s.send(c,'请看附件',id(),undefined,[r.id]);await driver.tick();await done;if(error)throw error;assert.equal(s.messages(c).at(-1).role,'assistant');
});

test('HTTP attachments upload/send/reload/download and static module use existing authenticated paths',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-file-http-')),app=startServer({port:0,dataDir:dir});await once(app.server,'listening');t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0],headers={Cookie:cookie,'Content-Type':'application/json'},post=async(path,input)=>{const response=await fetch(base+'/api/'+path,{method:'POST',headers,body:JSON.stringify(input)});assert.equal(response.status,200);return response.json();};
 const c=chats(app.store).discovery,body='真实 Markdown 内容，HTML 是数据 <script>alert(1)</script>',payload={request_id:id(),file:{name:'中文.md',base64:Buffer.from(body).toString('base64')}};
 const resource=await post('resources',payload);assert.deepEqual(await post('resources',payload),resource);
 const input={conversation_id:c,content:'请看附件',task_kind:'chat',attachment_resource_ids:[resource.id],request_id:id()},sent=await post('messages',input);assert.deepEqual(await post('messages',input),sent);
 const messages=await(await fetch(base+'/api/messages?conversation_id='+c,{headers})).json();assert.equal(messages[0].attachments[0].name,'中文.md');assert.equal(messages[0].content,'请看附件');
 const response=await fetch(base+messages[0].attachments[0].download_url,{headers});assert.equal(await response.text(),body);assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.equal((await fetch(base+messages[0].attachments[0].download_url)).status,401);
 assert.equal((await fetch(base+'/chat-attachments.js')).status,200);assert.equal(count(app.store,'message_attachments'),1);
});
