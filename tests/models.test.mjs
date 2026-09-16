import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore,id} from '../server/store.mjs';
import {modelExecutor,completion} from '../server/model-executor.mjs';
import {normalizeBase} from '../server/model-config.mjs';
import {startServer} from '../server/index.mjs';
import {once} from 'node:events';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const reply=(message,usage={total_tokens:10})=>new Response(JSON.stringify({choices:[{finish_reason:message.tool_calls?'tool_calls':'stop',message}],usage}),{headers:{'Content-Type':'application/json'}});
const call=(name,args,cid=id())=>({id:cid,type:'function',function:{name,arguments:JSON.stringify(args)}});
function setup(t,fetcher){const s=createStore(':memory:');const x=modelExecutor(s,{fetcher,intervalMs:1000000});t.after(async()=>{await x.stop();s.db.close();});const g=s.createGoal({title:'路由测试',domain:'测试'});return {s,x,g};}
function profile(s,name='Model A',model='model-a'){return s.models.save({name,base_url:'https://models.example/v1',model,key:'test-not-a-real-secret',options:{max_tokens:3000}});}
function route(s,module,p){s.models.routes({routes:[{module,profile_id:p.id}]});s.models.enabled(true);}
function send(s,c,kind='chat',content_id){const r=s.send(c,'请处理本次测试',id());const j=s.db.prepare('SELECT id FROM jobs WHERE message_id=?').get(r.message_id);s.models.tag(j.id,kind,content_id);return j.id;}

test('profile validation, encrypted keys, redaction and endpoint changes',t=>{
 const {s}=setup(t,()=>{throw Error('no network');});const p=profile(s);assert.equal(p.has_key,true);assert.ok(!JSON.stringify(s.overview()).includes('test-not-a-real-secret'));assert.ok(!s.db.prepare('SELECT key_cipher FROM model_profiles').get().key_cipher.includes('test-not-a-real-secret'));assert.equal(s.models.profile(p.id,true).key,'test-not-a-real-secret');
 assert.throws(()=>s.models.save({...p,base_url:'https://other.example',key:''}),/重新填写/);assert.equal(s.models.save({...p,key:'',clear_key:true}).has_key,false);
 for(const url of ['http://remote.example','https://user:key@example.com','https://example.com/?key=x'])assert.throws(()=>normalizeBase(url));assert.equal(normalizeBase('http://127.0.0.1:9000/v1/chat/completions'),'http://127.0.0.1:9000/v1');
});

test('module routing isolates host jobs and uses different actual request models',async t=>{
 const seen=[];const {s,x,g}=setup(t,async(url,opts)=>{const body=JSON.parse(opts.body);seen.push(body.model);assert.equal(opts.redirect,'error');assert.ok(!opts.body.includes('test-not-a-real-secret'));if(body.model==='model-b'&&!body.messages.some(m=>m.role==='tool'))return reply({tool_calls:[call('teacher_propose_capabilities',{items:[{title:'能力',kind:'CORE',requirements:[{node:'知识点',description:'解释原理'}]}]})]});return reply({content:'模型已处理'});});
 const a=profile(s),b=profile(s,'Model B','model-b');route(s,'chat',a);route(s,'capabilities',b);const jid=send(s,g.conversation.id);assert.equal(s.claim('Codex').job,null);await x.tick();assert.equal(s.messages(g.conversation.id).at(-1).content,'模型已处理');assert.equal(s.models.state().runs[0].status,'COMPLETED');
 send(s,g.conversation.id,'capabilities');await x.tick();assert.deepEqual(seen,['model-a','model-b','model-b']);assert.equal(s.learning.state(g.goal.id).capability_sets[0].status,'PENDING');assert.equal(s.overview().goals[0].status,'INITIALIZING');assert.equal(s.db.prepare('SELECT status FROM jobs WHERE id=?').get(jid).status,'COMPLETED');
 s.models.routes({routes:[{module:'chat',profile_id:null}]});send(s,g.conversation.id);assert.ok(s.claim('Codex').job);
});

test('material tool execution reads only selected material and records real analysis',async t=>{
 let step=0,contentId;const {s,x,g}=setup(t,async(_url,opts)=>{const body=JSON.parse(opts.body);assert.ok(!opts.body.includes('archived-secret'));step++;if(step===1)return reply({tool_calls:[call('teacher_read_material',{content_id:contentId})]});if(step===2){assert.ok(body.messages.some(m=>m.role==='tool'&&m.content.includes('缓存复用正文')));return reply({tool_calls:[call('teacher_analyze_material',{content_id:contentId,status:'ANALYZED',summary:'该范围说明了缓存复用'})]});}return reply({content:'已分析约定范围。'});});
 const r=s.resource({goal_id:g.goal.id,title:'材料',role:'PRIMARY'}),c=s.learning.material({resource_id:r.id,scope:'第一节',content:'缓存复用正文'});contentId=c.id;const n=s.saveNote({goal_id:g.goal.id,title:'归档',content:'archived-secret'});s.archiveNote(n.id,true);route(s,'material',profile(s));send(s,g.conversation.id,'material',contentId);await x.tick();assert.equal(s.learning.state(g.goal.id).material_analysis.length,1);assert.equal(s.models.state().runs[0].status,'COMPLETED');
});

test('assessment API writes question, accepts real answer, feedback and completion',async t=>{
 let req,round,step=0;const {s,x,g}=setup(t,async()=>{step++;if(step===1)return reply({tool_calls:[call('teacher_assessment_question',{question:'请解释缓存复用',requirement_ids:[req]})]});if(step===2)return reply({tool_calls:[call('teacher_assessment_feedback',{round_id:round,feedback:'回答说明了复用关系'})]});return reply({tool_calls:[call('teacher_finish_assessment',{summary:'完成本次诊断',profile:'能解释复用关系',change_summary:'初次验证',relations:[{requirement_id:req,relation:'SUPPORTS'}],gaps:[],readiness:[],completion_recommended:false})]});});
 const p=s.learning.proposeCapabilities({goal_id:g.goal.id,request_id:id(),items:[{title:'缓存',kind:'CORE',requirements:[{node:'KV',description:'解释复用'}]}]});s.learning.confirmCapabilities({id:p.proposal_id,accept:true});req=s.learning.state(g.goal.id).requirements[0].id;
 route(s,'assessment',profile(s));const a=s.learning.begin({goal_id:g.goal.id,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',request_id:id()});await x.tick();assert.equal(s.learning.state(g.goal.id).assessments[0].status,'WAITING_ANSWER');round=s.learning.rounds({id:a.assessment_id})[0].id;s.send(a.conversation_id,'历史 Key 与 Value 被后续查询重复使用。',id());await x.tick();assert.equal(s.learning.state(g.goal.id).assessments[0].status,'COMPLETED');assert.equal(s.overview().evidence.length,1);assert.equal(s.models.state().runs.length,2);
});

test('failed API blocks automatic repeats and supports explicit retry without leaking response',async t=>{
 let good=false,count=0;const {s,x,g}=setup(t,async()=>{count++;return good?reply({content:'重试成功'}):new Response('test-not-a-real-secret provider error',{status:401});});route(s,'chat',profile(s));const job=send(s,g.conversation.id);await x.tick();await x.tick();assert.equal(count,1);assert.equal(s.models.state().runs[0].status,'FAILED');assert.ok(!JSON.stringify(s.models.state()).includes('test-not-a-real-secret'));assert.equal(s.claim('Codex').job,null);good=true;s.models.reroute({job_id:job,mode:'API'});await x.tick();assert.equal(count,2);assert.equal(s.messages(g.conversation.id).at(-1).content,'重试成功');
});

test('cancellation during network request discards late response',async t=>{
 let release,started;const ready=new Promise(r=>started=r);const {s,x,g}=setup(t,async()=>{started();return new Promise(r=>{release=()=>r(reply({content:'应被丢弃'}));});});route(s,'chat',profile(s));const job=send(s,g.conversation.id);const work=x.tick();await ready;s.cancel(job);release();await work;assert.equal(s.messages(g.conversation.id).length,1);assert.equal(s.models.state().runs[0].status,'CANCELLED');
});

test('model endpoints require Web session, preserve secrets across restart, export excludes models',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-model-http-'));let app=startServer({port:0,dataDir:dir,executorOptions:{intervalMs:1000000}});await once(app.server,'listening');t.after(async()=>{if(app){app.close();await once(app.server,'close');}rmSync(dir,{recursive:true,force:true});});const base='http://127.0.0.1:'+app.server.address().port;const cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0];
 const post=(path,data,extra={})=>fetch(base+'/api/'+path,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',...extra},body:JSON.stringify(data)});
 assert.equal((await post('models/profile',{}, {Authorization:'Bearer '+app.token})).status,403);
 const saved=await(await post('models/profile',{name:'测试连接',base_url:'https://example.com/v1',model:'test',key:'mock-local-secret'})).json();assert.equal(saved.has_key,true);assert.ok(!JSON.stringify(saved).includes('mock-local-secret'));const exported=await(await fetch(base+'/api/export',{headers:{Cookie:cookie}})).json();assert.equal(exported.models,undefined);assert.ok(!readFileSync(join(dir,'teacher.sqlite')).includes(Buffer.from('mock-local-secret')));
 app.close();await once(app.server,'close');app=null;const s=createStore(join(dir,'teacher.sqlite'));assert.equal(s.models.profile(saved.id,true).key,'mock-local-secret');s.db.close();
});

test('adapter fails closed on incompatible response and supports selectable token parameter',async()=>{
 const p={base_url:'https://example.com',model:'test',key:'',options:{max_tokens:99,token_parameter:'max_completion_tokens'}};
 await assert.rejects(completion(p,[{role:'user',content:'test'}],[],{fetcher:async(_url,o)=>{const b=JSON.parse(o.body);assert.equal(b.max_completion_tokens,99);assert.equal(b.max_tokens,undefined);return new Response('{}');}}),/完整结果/);
});

test('API cannot read another goal material or invoke user-only/unrelated tools',async t=>{
 let foreign,step=0;const {s,x,g}=setup(t,async(_u,o)=>{const body=JSON.parse(o.body);assert.ok(!o.body.includes('private-other-goal-body'));step++;if(step===1)return reply({tool_calls:[call('teacher_read_material',{content_id:foreign}),call('teacher_propose_capabilities',{items:[]})]});assert.ok(body.messages.some(m=>m.role==='tool'&&m.content.includes('不属于')));assert.ok(body.messages.some(m=>m.role==='tool'&&m.content.includes('不允许')));return reply({content:'无法读取指定范围之外的资料。'});});
 const other=s.createGoal({title:'别的目标',domain:'测试'}),resource=s.resource({goal_id:other.goal.id,title:'私有',role:'PRIMARY'});foreign=s.learning.material({resource_id:resource.id,scope:'范围',content:'private-other-goal-body'}).id;
 const own=s.resource({goal_id:g.goal.id,title:'自己的资料',role:'PRIMARY'}),content=s.learning.material({resource_id:own.id,scope:'范围',content:'可读正文'});route(s,'material',profile(s));send(s,g.conversation.id,'material',content.id);await x.tick();assert.equal(s.learning.state(g.goal.id).capability_sets.length,0);
});

test('roadmap model produces a proposal and cannot activate it',async t=>{
 let req,step=0;const {s,x,g}=setup(t,async()=>{step++;return step===1?reply({tool_calls:[call('teacher_plan_learning',{title:'分阶段路线',summary:'基于诊断安排',phases:[{title:'基础',topics:[{key:'base',title:'原理',requirement_ids:[req],resource_ids:[],dependencies:[],sessions:[{title:'学习原理',objective:'独立解释'}]}]}]})]}):reply({content:'路线已提交，请在 Web 确认。'});});
 const p=s.learning.proposeCapabilities({goal_id:g.goal.id,request_id:id(),items:[{title:'原理能力',kind:'CORE',requirements:[{node:'基础',description:'解释原理'}]}]});s.learning.confirmCapabilities({id:p.proposal_id,accept:true});req=s.learning.state(g.goal.id).requirements[0].id;const a=s.learning.begin({goal_id:g.goal.id,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',request_id:id()});s.learning.endEarly({id:a.assessment_id});route(s,'roadmap',profile(s));send(s,g.conversation.id,'roadmap');await x.tick();assert.equal(s.overview().proposals[0].status,'PENDING');assert.equal(s.overview().sessions.length,0);assert.equal(s.models.state().runs[0].status,'COMPLETED');
});

test('failed job preserves FIFO and explicit host handoff unblocks the conversation',async t=>{
 const {s,x,g}=setup(t,async()=>new Response('',{status:500}));route(s,'chat',profile(s));const first=send(s,g.conversation.id),second=send(s,g.conversation.id);await x.tick();await x.tick();assert.equal(s.models.state().runs.length,1);s.models.reroute({job_id:first,mode:'HOST'});const claim=s.claim('Codex');assert.equal(claim.job.id,first);s.reply({job_id:first,lease_token:claim.job.lease_token,content:'宿主完成',request_id:id()});await x.tick();assert.equal(s.models.state().runs[0].job_id,second);
});
