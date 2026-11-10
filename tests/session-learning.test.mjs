import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once,EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createStore,id} from '../server/store.mjs';
import {startServer} from '../server/index.mjs';
import {modelExecutor} from '../server/model-executor.mjs';
import {agentInvoke} from '../server/agent-mcp.mjs';
import {callJobTool} from '../server/tools.mjs';
import {executionTools,planningChatPrompt,sessionLearningPrompt} from '../server/agent-policy.mjs';
import {codexHost} from '../server/codex-host.mjs';
import {harnessHost} from '../server/harness-host.mjs';
import {acpMemoryProcess} from './fixtures/acp-memory.mjs';

function route(s,title='路由原理'){
 const g=s.createGoal({title,domain:'计算机',scope:'只讨论单机推理'});
 const p=s.propose({goal_id:g.goal.id,title:'已讨论的路线',summary:'学习原理再做比较',items:[{title:'D1 路由',objective:'解释单机路由原理'},{title:'D2 比较',objective:'比较两种策略'}],request_id:id()});
 return {...g,proposal_id:p.proposal_id,accept(){s.decide(p.proposal_id,true);return s.overview().sessions.filter(x=>x.goal_id===g.goal.id);}};
}
function setup(t){const s=createStore(':memory:');t.after(()=>s.db.close());const g=route(s),sessions=g.accept();return {s,g,sessions};}
const count=(s,table)=>s.db.prepare('SELECT count(*) AS n FROM '+table).get().n;

test('accepted tasks get separate persistent chats, deduplicated without creating lessons or evidence',t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-session-learning-')),file=join(dir,'teacher.sqlite');let s=createStore(file);t.after(()=>{s.db.close();rmSync(dir,{recursive:true,force:true});});
 const g=route(s),[task,next]=g.accept(),request_id=id();
 const first=s.sessionLearning.open({session_id:task.id,request_id});
 assert.deepEqual(s.sessionLearning.open({session_id:task.id,request_id}),first);
 assert.deepEqual(s.sessionLearning.open({session_id:task.id,request_id:id()}),first);
 const second=s.sessionLearning.open({session_id:next.id,request_id:id()});assert.notEqual(second.conversation_id,first.conversation_id);
 assert.equal(s.context(first.conversation_id).conversation.kind,'SESSION_LEARNING');
 assert.equal(s.context(first.conversation_id).session_learning.planning_conversation.id,g.conversation.id);
 assert.equal(s.context(first.conversation_id).session_learning.session.id,task.id);
 assert.equal(s.context(first.conversation_id).goal.id,g.goal.id);
 assert.equal(s.context(first.conversation_id).learning.assessment,null);
 for(const table of ['messages','jobs','evidence','profiles','assessments'])assert.equal(count(s,table),0,table);
 assert.equal(s.overview().sessions[0].conversation_id,null);
 assert.equal(s.overview().sessions[0].status,'PLANNED');
 s.db.close();s=createStore(file);assert.deepEqual(s.sessionLearning.open({session_id:task.id,request_id:id()}),first);assert.equal(s.overview().session_chats.length,2);
});

test('only approved executable tasks can create chats; foreign goal/proposal bindings fail closed',t=>{
 const {s,g,sessions:[task]}=setup(t),other=route(s,'另一个目标');other.accept();
 assert.throws(()=>s.sessionLearning.open({session_id:'missing',request_id:id()}),/不存在/);
 s.db.prepare("UPDATE proposals SET status='PENDING' WHERE id=?").run(g.proposal_id);
 assert.throws(()=>s.sessionLearning.open({session_id:task.id,request_id:id()}),/确认/);
 s.db.prepare("UPDATE proposals SET status='ACCEPTED' WHERE id=?").run(g.proposal_id);
 s.db.prepare('UPDATE sessions SET proposal_id=? WHERE id=?').run(other.proposal_id,task.id);
 assert.throws(()=>s.sessionLearning.open({session_id:task.id,request_id:id()}),/确认/);
 assert.equal(count(s,'session_chats'),0);assert.equal(count(s,'jobs'),0);
});

test('structured learning context contains exact task material excerpts and the route output planning origin',async t=>{
 const s=createStore(':memory:');t.after(()=>s.db.close());const g=s.createGoal({title:'学习缓存',domain:'推理'}),l=s.learning;
 const set=l.proposeCapabilities({goal_id:g.goal.id,items:[{title:'缓存原理',kind:'CORE',requirements:[{node:'KV',description:'解释缓存复用'}]}],request_id:id()});l.confirmCapabilities({id:set.proposal_id,accept:true});const req=l.state(g.goal.id).requirements[0].id;
 const assigned=s.resource({goal_id:g.goal.id,title:'任务材料',role:'REFERENCE',scope:'第一节'}).id;
 l.material({goal_id:g.goal.id,resource_id:assigned,scope:'第一节',content:'旧版已替换，不能进入当前教学'});
 const latest=l.material({goal_id:g.goal.id,resource_id:assigned,scope:'第一节',content:'当前任务正文：历史 K/V 可复用。'+('解释'.repeat(8000))});
 l.analyzeMaterial({goal_id:g.goal.id,content_id:latest.id,status:'ANALYZED',summary:'已检查当前任务正文',request_id:id()});
 const unrelated=s.resource({goal_id:g.goal.id,title:'其他任务材料',role:'REFERENCE',scope:'其他节'}).id;l.material({goal_id:g.goal.id,resource_id:unrelated,scope:'其他节',content:'不属于本任务的保留资料'});
 const foreign=s.createGoal({title:'其他目标',domain:'其他'}),foreignMaterial=s.resource({goal_id:foreign.goal.id,title:'其他目标材料',role:'REFERENCE',scope:'其他目标'}).id;l.material({goal_id:foreign.goal.id,resource_id:foreignMaterial,scope:'其他目标',content:'其他目标正文'});
 const diagnosis=l.begin({goal_id:g.goal.id,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',scope:'初始诊断',requirement_ids:[req],resource_ids:[],request_id:id()});l.endEarly({id:diagnosis.assessment_id});
 const source=s.newConversation(g.goal.id,'实际制定当前路线的对话');s.send(source.id,'只沿用这个讨论中的缓存主题',id());const sourceJob=s.claim('source',source.id).job;s.reply({job_id:sourceJob.id,lease_token:sourceJob.lease_token,content:'按这个范围继续制定。',request_id:id()});
 s.planningFlow.start({goal_id:g.goal.id,conversation_id:source.id,request_id:id()});const job=s.claim('planner',source.id).job;
 const planned=callJobTool(s,job.id,'teacher_plan_learning',{goal_id:g.goal.id,job_id:job.id,lease_token:job.lease_token,title:'缓存路线',summary:'原理学习',phases:[{title:'基础',topics:[{key:'kv',title:'缓存机制',requirement_ids:[req],resource_ids:[assigned],dependencies:[],sessions:[{title:'理解缓存',objective:'解释缓存复用'}]}]}],request_id:id()});
 l.decide({id:planned.proposal_id,accept:true});const task=s.overview().sessions[0],opened=s.sessionLearning.open({session_id:task.id,request_id:id()}),context=s.context(opened.conversation_id),scoped=context.session_learning;
 assert.equal(scoped.details.phase,'基础');assert.equal(scoped.capabilities[0].id,req);
 assert.deepEqual(scoped.resources.map(r=>r.id),[assigned]);assert.equal(scoped.materials.length,1);assert.equal(scoped.materials[0].content_id,latest.id);assert.equal(scoped.materials[0].scope,'第一节');assert.ok(scoped.materials[0].hash);assert.equal(scoped.materials[0].content.length,12000);assert.equal(scoped.materials[0].truncated,true);assert.match(scoped.materials[0].content,/当前任务正文/);
 assert.ok(!JSON.stringify(context).includes('旧版已替换'));assert.ok(!JSON.stringify(context).includes('不属于本任务的保留资料'));assert.ok(!JSON.stringify(context).includes('其他目标正文'));
 assert.equal(scoped.planning_conversation.id,source.id);assert.equal(scoped.planning_origin,'ROUTE_OUTPUT');assert.ok(JSON.stringify(scoped.planning_conversation.messages).includes('只沿用这个讨论'));
 const mapping=s.overview().session_chats[0];assert.equal(mapping.planning_conversation_id,source.id);assert.equal(mapping.planning_origin,'ROUTE_OUTPUT');
 const model=s.models.save({name:'材料答疑',base_url:'https://example.test/v1',model:'grounded-chat',key:''});s.models.routes({routes:[{module:'chat',profile_id:model.id}]});s.models.enabled(true);let grounded=false;
 const executor=modelExecutor(s,{intervalMs:1e9,fetcher:async(_url,o)=>{const body=JSON.parse(o.body),input=JSON.parse(body.messages.find(m=>m.role==='user').content).context;assert.match(input.session_learning.materials[0].content,/当前任务正文/);assert.equal(input.session_learning.materials[0].content_id,latest.id);assert.equal(input.session_learning.planning_conversation.id,source.id);assert.ok(!o.body.includes('不属于本任务的保留资料'));assert.ok(!o.body.includes('其他目标正文'));grounded=true;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'根据任务材料第一节，历史 K/V 可复用。'}}]}));}});t.after(()=>executor.stop());
 s.send(opened.conversation_id,'根据任务材料解释缓存',id());await executor.tick();assert.equal(grounded,true);assert.equal(count(s,'evidence'),0);assert.equal(count(s,'profiles'),0);
 const assessment=s.startSession(task.id);assert.notEqual(assessment.conversation_id,opened.conversation_id);assert.equal(s.context(opened.conversation_id).session_learning.read_only,true);assert.match(s.overview().session_chats[0].unavailable_reason,/正在正式考察/);
 l.endEarly({id:assessment.assessment_id});assert.equal(s.context(opened.conversation_id).session_learning.read_only,false);
});

test('completed task has a precise read-only reason',t=>{
 const {s,sessions:[task]}=setup(t),opened=s.sessionLearning.open({session_id:task.id,request_id:id()}),assessment=s.startSession(task.id);
 const answer=s.send(assessment.conversation_id,'实际回答足以说明复用',id());s.assessment({conversation_id:assessment.conversation_id,source_message_ids:[answer.message_id],summary:'保存本次考察结论',profile:'具备原理解释证据',change_summary:'实际回答产生证据',request_id:id()});
 assert.equal(s.context(opened.conversation_id).session_learning.read_only,true);assert.match(s.overview().session_chats[0].unavailable_reason,/已完成/);assert.throws(()=>s.send(opened.conversation_id,'继续',id()),/已完成/);
});

for(const invalidation of ['defer','remove','pause','end','supersede'])test(invalidation+' keeps existing history read-only and refuses create/send/claim',t=>{
 const {s,g,sessions:[task,next]}=setup(t),c=s.sessionLearning.open({session_id:task.id,request_id:id()}).conversation_id;
 s.send(c,'解释路由',id());
 if(invalidation==='defer'){s.rollingPlan.defer({session_id:task.id});s.rollingPlan.defer({session_id:next.id});}
 if(invalidation==='remove'){s.rollingPlan.removeSession({session_id:task.id});s.rollingPlan.removeSession({session_id:next.id});}
 if(invalidation==='pause')s.setGoalStatus(g.goal.id,'PAUSED');
 if(invalidation==='end')s.learning.endGoal({id:g.goal.id,status:'ABANDONED'});
 if(invalidation==='supersede'){const p=s.propose({goal_id:g.goal.id,title:'新版',summary:'替换路线',items:[{title:'新任务',objective:'新范围'}],request_id:id()});s.decide(p.proposal_id,true);}
 assert.deepEqual(s.sessionLearning.open({session_id:task.id,request_id:id()}),{conversation_id:c});
 assert.equal(s.messages(c).length,1);assert.equal(s.context(c).session_learning.read_only,true);assert.equal(s.overview().session_chats[0].read_only,true);
 const before=count(s,'jobs');assert.throws(()=>s.send(c,'继续',id()));assert.equal(count(s,'jobs'),before);
 assert.throws(()=>s.sessionLearning.open({session_id:next.id,request_id:id()}));assert.equal(s.claim('test',c).job,null);
});

test('session learning uses configured normal chat model, scoped role prompt, and no formal write tools',async t=>{
 const {s,sessions:[task]}=setup(t),c=s.sessionLearning.open({session_id:task.id,request_id:id()}).conversation_id;let requests=0;
 const p=s.models.save({name:'专属普通对话',base_url:'https://example.test/v1',model:'configured-chat',key:''});s.models.routes({routes:[{module:'chat',profile_id:p.id}]});s.models.enabled(true);
 for(const module of ['material','capabilities','roadmap','assessment','review','final'])assert.throws(()=>s.models.validateTask(c,module),/仅支持普通对话/);
 assert.deepEqual(executionTools({module:'assessment'},{conversation:{kind:'SESSION_LEARNING'}}),['teacher_reply']);
 const x=modelExecutor(s,{intervalMs:1e9,fetcher:async(_url,o)=>{requests++;const body=JSON.parse(o.body);assert.equal(body.model,'configured-chat');assert.deepEqual(body.tools.map(t=>t.function.name),['teacher_reply']);assert.ok(body.messages.some(m=>m.role==='system'&&m.content===sessionLearningPrompt));assert.ok(body.messages.some(m=>m.content?.includes(task.objective)));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'先解释路由，再按你的需要给练习。'}}]}));}});t.after(()=>x.stop());
 await x.tick();assert.equal(requests,0);s.send(c,'请解释路由并给一题练习',id());await x.tick();assert.equal(requests,1);assert.equal(s.messages(c).at(-1).role,'assistant');
 assert.equal(count(s,'evidence'),0);assert.equal(count(s,'profiles'),0);assert.equal(count(s,'assessments'),0);assert.equal(s.overview().sessions[0].status,'PLANNED');
 assert.match(planningChatPrompt,/不得在此直接启动正式 D1/);assert.match(planningChatPrompt,/下一工作流阶段/);
});

test('scoped MCP and shared job tools refuse planning/evidence escalation from learning',t=>{
 const {s,sessions:[task]}=setup(t);s.agents.configure({role:'chat',mode:'MCP'});const c=s.sessionLearning.open({session_id:task.id,request_id:id()}).conversation_id;
 s.send(c,'解释任务',id());const claimed=agentInvoke(s,'chat','teacher_claim_message',{conversation_id:c}),a={job_id:claimed.job.id,lease_token:claimed.job.lease_token,request_id:id()};
 assert.equal(claimed.context.conversation_role_instructions,sessionLearningPrompt);
 assert.throws(()=>agentInvoke(s,'chat','teacher_advance_learning_plan',a),/不允许/);
 for(const name of ['teacher_advance_learning_plan','teacher_finish_assessment','teacher_plan_learning'])assert.throws(()=>callJobTool(s,claimed.job.id,name,a),/不允许/);
 s.rollingPlan.removeSession({session_id:task.id});assert.throws(()=>agentInvoke(s,'chat','teacher_reply',{...a,content:'继续教学'}));assert.equal(s.messages(c).length,1);
});

test('HTTP learning endpoint is idempotent; task kind cannot be escalated; archived history stays readable',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-learning-api-')),app=startServer({port:0,dataDir:dir});await once(app.server,'listening');t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const url='http://127.0.0.1:'+app.server.address().port,page=await fetch(url),cookie=page.headers.get('set-cookie').split(';')[0];
 const request=async(path,body)=>fetch(url+'/api/'+path,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const g=route(app.store),[task]=g.accept(),input={session_id:task.id,request_id:id()};
 let response=await request('sessions/learning',input);assert.equal(response.status,200);const opened=await response.json();
 response=await request('sessions/learning',{...input,request_id:id()});assert.deepEqual(await response.json(),opened);
 assert.equal(count(app.store,'jobs'),0);
 response=await request('messages',{conversation_id:opened.conversation_id,task_kind:'assessment',content:'直接记成掌握',request_id:id()});assert.equal(response.status,409);assert.equal(count(app.store,'jobs'),0);
 app.store.rollingPlan.removeSession({session_id:task.id});response=await request('messages',{conversation_id:opened.conversation_id,task_kind:'chat',content:'继续',request_id:id()});assert.equal(response.status,409);
 response=await fetch(url+'/api/messages?conversation_id='+opened.conversation_id,{headers:{Cookie:cookie}});assert.equal(response.status,200);assert.deepEqual(await response.json(),[]);
});

for(const harness of ['LEGACY_CODEX','CODEX','DSH'])test(harness+' receives the learning role and only context/reply tools',async t=>{
 const {s,sessions:[task]}=setup(t),dir=mkdtempSync(join(tmpdir(),'teacher-learning-host-'));let driver,error,finished;const done=new Promise(r=>finished=r);
 const c=s.sessionLearning.open({session_id:task.id,request_id:id()}).conversation_id;
 const exercise=(prompt,token)=>{
  assert.ok(prompt.includes(sessionLearningPrompt));const invoke=(name,args={})=>harness==='LEGACY_CODEX'?driver.invoke({name,arguments:args,operation_id:id()}):driver.invoke(token,{name,arguments:args,operation_id:id()});
  const catalog=harness==='LEGACY_CODEX'?driver.catalog():driver.catalog(token);assert.equal(new Set(catalog.tools.map(t=>t.name)).size,catalog.tools.length);assert.ok(!catalog.tools.some(t=>/advance_learning|assessment|plan_learning/.test(t.name)));
  assert.equal(invoke('teacher_get_context').session_learning.session.id,task.id);invoke('teacher_reply',{content:'按当前任务解释路由。请选择：',choice:{type:'SINGLE',options:[{id:'A',text:'继续原理'},{id:'B',text:'先看例子'}]}});
 };
 const spawnProcess=(_exe,_args,opts)=>{
  if(harness==='DSH')return acpMemoryProcess(opts,{onPrompt:({prompt,token})=>exercise(prompt,token),onComplete:finished,onError:e=>{error=e;finished();}});
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();let prompt='';child.stdin.on('data',d=>prompt+=d);child.kill=()=>child.emit('close',1);child.stdin.on('finish',()=>setImmediate(()=>{try{exercise(prompt,opts.env.TEACHER_HOST_TOKEN);}catch(e){error=e;}finally{child.emit('close',0);finished();}}));return child;
 };
 if(harness==='LEGACY_CODEX'){s.hostConfig.save({enabled:true});driver=codexHost(s,{dataDir:dir,baseUrl:()=>'',spawnProcess,intervalMs:1e9});}
 else{s.agents.configure({role:'chat',mode:'MCP',harness,executable:process.execPath,...(harness==='DSH'?{model:'custom/model'}:{})});driver=harnessHost(s,{dataDir:dir,baseUrl:()=>'',spawnProcess,readDshModel:()=>null,intervalMs:1e9});}
 try{s.send(c,'解释当前任务',id());await driver.tick();await done;if(error)throw error;assert.equal(s.messages(c).at(-1).role,'assistant');assert.equal(s.messages(c).at(-1).choice.status,'OPEN');}
 finally{await driver.stop();rmSync(dir,{recursive:true,force:true});}
});

for(const diagnostic of [
 {status:400,body:{error:{message:'tools are not supported provider-private-text'}}},
 {status:422,body:{error:{param:'tools',code:'unsupported_parameter',message:'provider-private-text'}}}
])test('session API explicitly unsupported tools retries once as a plain text lesson: '+diagnostic.status,async t=>{
 const {s,sessions:[task]}=setup(t),c=s.sessionLearning.open({session_id:task.id,request_id:id()}).conversation_id,p=s.models.save({name:'text-only',base_url:'https://example.test/v1',model:'lesson-text',key:''});s.models.routes({routes:[{module:'chat',profile_id:p.id}]});s.models.enabled(true);let requests=0;
 const driver=modelExecutor(s,{intervalMs:1e9,fetcher:async(_u,o)=>{requests++;const payload=JSON.parse(o.body);if(requests===1){assert.deepEqual(payload.tools.map(t=>t.function.name),['teacher_reply']);return new Response(JSON.stringify(diagnostic.body),{status:diagnostic.status});}assert.equal(payload.tools,undefined);assert.ok(payload.messages.some(m=>m.role==='system'&&m.content?.includes('当前任务的讲解')));assert.ok(!JSON.stringify(payload.messages).includes('把这段讨论整理成学习路线'));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'路由根据请求特征选择执行路径。请用文字解释一种选择条件。'}}]}));}});t.after(()=>driver.stop());
 s.send(c,'解释路由并让我练习',id());await driver.tick();await driver.tick();assert.equal(requests,2);const reply=s.messages(c).at(-1);assert.equal(reply.role,'assistant');assert.match(reply.content,/路由根据请求特征/);assert.match(reply.content,/文字作答/);assert.ok(!reply.content.includes('学习路线'));assert.equal(reply.choice,undefined);assert.equal(s.models.state().runs[0].status,'COMPLETED');assert.ok(!JSON.stringify(s.models.state()).includes('provider-private-text'));assert.equal(count(s,'evidence'),0);
});

for(const diagnostic of [
 {status:400,body:{error:{message:'invalid temperature'}}},
 {status:401,body:{error:{message:'tools are not supported'}}},
 {status:500,body:{error:{param:'tools',code:'unsupported_parameter'}}}
])test('session API does not treat unrelated/provider errors as unsupported tools: '+diagnostic.status,async t=>{
 const {s,sessions:[task]}=setup(t),c=s.sessionLearning.open({session_id:task.id,request_id:id()}).conversation_id,p=s.models.save({name:'errors',base_url:'https://example.test/v1',model:'lesson-text',key:''});s.models.routes({routes:[{module:'chat',profile_id:p.id}]});s.models.enabled(true);let requests=0;
 const driver=modelExecutor(s,{intervalMs:1e9,fetcher:async()=>{requests++;return new Response(JSON.stringify(diagnostic.body),{status:diagnostic.status});}});t.after(()=>driver.stop());s.send(c,'讲解当前任务',id());await driver.tick();await driver.tick();assert.equal(requests,1);assert.equal(s.models.state().runs[0].status,'FAILED');assert.equal(s.messages(c).length,1);
});
