import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore,id} from '../server/store.mjs';
import {modelExecutor} from '../server/model-executor.mjs';
import {executionTools,isPlanningChat,planningChatPrompt} from '../server/agent-policy.mjs';
import {agentInvoke,agentCatalog} from '../server/agent-mcp.mjs';
import {codexHost} from '../server/codex-host.mjs';
import {harnessHost} from '../server/harness-host.mjs';
import {acpMemoryProcess} from './fixtures/acp-memory.mjs';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const name='teacher_advance_learning_plan';
const response=message=>new Response(JSON.stringify({choices:[{finish_reason:message.tool_calls?'tool_calls':'stop',message}]}));
const call=args=>({id:id(),type:'function',function:{name,arguments:JSON.stringify(args)}});
function setup(t,fetcher){const s=createStore(':memory:'),g=s.createGoal({title:'学会路由设计',domain:'计算机'});const p=s.models.save({name:'chat',base_url:'https://example.test/v1',model:'chat',key:''});s.models.routes({routes:[{module:'chat',profile_id:p.id}]});s.models.enabled(true);const x=modelExecutor(s,{intervalMs:1e9,fetcher});t.after(async()=>{await x.stop();s.db.close();});return {s,g,x};}

test('ordinary planning exposes advance and reply tools with trusted binding and follows the real result',async t=>{
 let a,invoked=0,job;
 a=setup(t,async(_u,o)=>{const body=JSON.parse(o.body);assert.deepEqual(body.tools.map(t=>t.function.name),[name,'teacher_reply']);assert.deepEqual(Object.keys(body.tools[0].function.parameters.properties).sort(),['action','expected_revision','feedback','proposal_id']);assert.ok(body.messages.some(m=>m.role==='system'&&m.content===planningChatPrompt));
  if(!body.messages.some(m=>m.role==='tool'))return response({tool_calls:[call({job_id:'foreign',lease_token:'forged',request_id:'forged',content:'不得直接保存的路线'})]});
  assert.ok(body.messages.some(m=>m.role==='tool'&&JSON.parse(m.content).stage==='GENERATING_CAPABILITIES'));return response({content:'已交给能力要求功能整理，完成后请确认。'});
 });
 a.s.planningFlow={startFromJob(args){invoked++;assert.equal(args.job_id,job.job_id);assert.notEqual(args.lease_token,'forged');assert.notEqual(args.request_id,'forged');assert.equal(args.content,undefined);a.s.leased(args.job_id,args.lease_token);return {stage:'GENERATING_CAPABILITIES',goal_id:a.g.goal.id};}};
 job=a.s.send(a.g.conversation.id,'前面目标和范围就按这样，开始制定正式计划吧。',id());await a.x.tick();assert.equal(invoked,1);assert.equal(a.s.models.state().runs[0].status,'COMPLETED');assert.match(a.s.messages(a.g.conversation.id).at(-1).content,/能力要求/);
});

test('API tool advances real stored flow once and configured professional retains source discussion',async t=>{
 let phase='discussion',seenCapabilities=false;const original='我每周只有周二周四，目标是能解释路由决策；先做单机，暂不涉及跨机。';
 const a=setup(t,async(_u,o)=>{const body=JSON.parse(o.body);
  if(phase==='discussion')return response({content:'先围绕单机路由原理讨论这个范围。'});
  if(body.model==='capabilities'){
   assert.ok(JSON.stringify(body.messages).includes('暂不涉及跨机'));seenCapabilities=true;
   if(!body.messages.some(m=>m.role==='tool'))return response({tool_calls:[{id:id(),type:'function',function:{name:'teacher_propose_capabilities',arguments:JSON.stringify({items:[{title:'单机路由决策',kind:'CORE',requirements:[{node:'路由',description:'解释单机路由决策原理'}]}]})}}]});
   return response({content:'已整理能力要求，等待确认。'});
  }
  if(!body.messages.some(m=>m.role==='tool'))return response({tool_calls:[call({}),call({})]});
  return response({content:'正在由能力要求功能整理讨论结果。'});
 });
 const p=a.s.models.save({name:'capabilities',base_url:'https://example.test/v1',model:'capabilities',key:''});a.s.models.routes({routes:[{module:'capabilities',profile_id:p.id}]});
 a.s.send(a.g.conversation.id,original,id());await a.x.tick();phase='advance';const source=a.s.send(a.g.conversation.id,'同意这个目标和范围，开始制定吧。',id());await a.x.tick();
 const flow=a.s.planningFlow.state(a.g.goal.id);assert.ok(flow,'semantic tool must persist a real planning flow');assert.equal(flow.stage,'GENERATING_CAPABILITIES');assert.equal(a.s.db.prepare('SELECT source_message_id FROM planning_flows WHERE goal_id=?').get(a.g.goal.id).source_message_id,source.message_id);assert.equal(a.s.db.prepare('SELECT count(*) AS n FROM planning_flow_jobs WHERE goal_id=?').get(a.g.goal.id).n,1);
 await a.x.tick();assert.equal(seenCapabilities,true);assert.equal(a.s.planningFlow.state(a.g.goal.id).stage,'REVIEW_CAPABILITIES');assert.equal(a.s.learning.state(a.g.goal.id).capability_sets[0].status,'PENDING');assert.equal(a.s.overview().sessions.length,0);
});

for(const content of ['A','什么是 continuous batching？','我还不确定范围，能比较这两种方案吗？'])test('ordinary question stays text: '+content,async t=>{
 let invoked=0;const a=setup(t,async()=>response({content:'继续解释和讨论学习范围。'}));a.s.planningFlow={startFromJob(){invoked++;throw Error('must not call');}};a.s.send(a.g.conversation.id,content,id());await a.x.tick();assert.equal(invoked,0);assert.equal(a.s.messages(a.g.conversation.id).at(-1).content,'继续解释和讨论学习范围。');
});

test('tool policy excludes all other workflows and typed goal-chat actions',()=>{
 const task={module:'chat',agent_role:'chat'},c={goal:{id:'g'},conversation:{kind:'PLANNING'},learning:{assessment:null}};
 assert.equal(isPlanningChat(task,c),true);assert.deepEqual(executionTools(task,c),[name,'teacher_reply']);
 for(const patch of [{discovery:{}},{study:{kind:'READING'}},{orchestration:{}},{conversation:{kind:'SESSION'}},{learning:{assessment:{}}},{learning:{goal_chat_action:{intent:'NOTE_VERIFICATION'}}},{learning:{goal_chat_action:{intent:'KNOWLEDGE_PROFILE'}}},{learning:{goal_chat_action:{intent:'TOPIC_REORGANIZATION'}}}])assert.ok(!executionTools(task,{...c,...patch}).includes(name));
 for(const module of ['capabilities','roadmap','assessment','material','review','final'])assert.ok(!executionTools({...task,module},c).includes(name));
 assert.ok(!agentCatalog('master').some(t=>t.name===name));
});

test('scoped MCP binds source task, rejects expired leases, foreign roles and typed actions',t=>{
 const s=createStore(':memory:');t.after(()=>s.db.close());s.agents.configure({role:'chat',mode:'MCP'});const g=s.createGoal({title:'测试',domain:'测试'}),j=s.send(g.conversation.id,'按讨论方案推进',id()),claim=agentInvoke(s,'chat','teacher_claim_message',{});let count=0;
 s.planningFlow={startFromJob(args){count++;assert.equal(args.job_id,j.job_id);return {stage:'BLOCKED',blockers:['尚未配置能力要求功能']};}};
 const args={job_id:claim.job.id,lease_token:claim.job.lease_token,request_id:id()};assert.equal(claim.context.planning_chat_instructions,planningChatPrompt);assert.equal(agentInvoke(s,'chat',name,args).stage,'BLOCKED');assert.equal(count,1);assert.throws(()=>agentInvoke(s,'roadmap',name,args),/不允许/);
 s.db.prepare("INSERT INTO goal_chat_actions VALUES(?,'NOTE_VERIFICATION','note')").run(j.job_id);assert.throws(()=>agentInvoke(s,'chat',name,args),/不允许/);s.db.prepare('DELETE FROM goal_chat_actions WHERE job_id=?').run(j.job_id);
 s.db.prepare('UPDATE jobs SET lease_until=0 WHERE id=?').run(j.job_id);assert.throws(()=>agentInvoke(s,'chat',name,args),/失效/);assert.equal(count,1);
});

test('only explicit tool rejection retries ordinary chat once and never writes workflow state',async t=>{
 let requests=0,invoked=0;const a=setup(t,async(_u,o)=>{requests++;const b=JSON.parse(o.body);if(requests===1){assert.ok(b.tools);return new Response(JSON.stringify({error:{message:'tools are not supported private-diagnostic'}}),{status:400});}assert.equal(b.tools,undefined);assert.ok(b.messages.some(m=>m.content?.includes('本轮只能进行文字讨论')));return response({content:'可以继续讨论这个概念。'});});
 a.s.planningFlow={startFromJob(){invoked++;}};a.s.send(a.g.conversation.id,'什么是解码？',id());await a.x.tick();assert.equal(requests,2);assert.equal(invoked,0);assert.match(a.s.messages(a.g.conversation.id).at(-1).content,/把这段讨论整理成学习路线/);assert.ok(!JSON.stringify(a.s.models.state()).includes('private-diagnostic'));
});

for(const [status,message] of [[400,'invalid temperature'],[401,'tools not supported'],[500,'tools not supported']])test('generic/provider failures do not retry: '+status+' '+message,async t=>{
 let requests=0;const a=setup(t,async()=>{requests++;return new Response(message,{status});});a.s.send(a.g.conversation.id,'开始制定计划',id());await a.x.tick();await a.x.tick();assert.equal(requests,1);assert.equal(a.s.models.state().runs[0].status,'FAILED');
});

test('unsupported tools after successful side effect blocks rather than retrying without tools',async t=>{
 let requests=0,invoked=0;const a=setup(t,async()=>++requests===1?response({tool_calls:[call({})]}):new Response('tools not supported',{status:422}));a.s.planningFlow={startFromJob(){invoked++;return {stage:'GENERATING_CAPABILITIES'};}};a.s.send(a.g.conversation.id,'开始制定计划',id());await a.x.tick();assert.equal(requests,2);assert.equal(invoked,1);assert.equal(a.s.models.state().runs[0].status,'FAILED');
});

for(const harness of ['LEGACY_CODEX','CODEX','DSH'])test('scoped '+harness+' transport binds planning tool and refreshes context',async t=>{
 const s=createStore(':memory:'),dir=mkdtempSync(join(tmpdir(),'teacher-plan-tools-'));let driver,observedError,finished;const done=new Promise(r=>finished=r);let calls=0;
 const g=s.createGoal({title:'路由',domain:'计算机'});
 s.planningFlow={startFromJob(args){calls++;assert.equal(args.job_id,job.job_id);assert.notEqual(args.lease_token,'forged');assert.equal(args.content,undefined);s.leased(args.job_id,args.lease_token);return {stage:'BLOCKED',blockers:['配置未完成']};}};
 const exercise=(prompt,token)=>{
   assert.ok(prompt.includes(planningChatPrompt));
   const invoke=(tool,args={})=>harness==='LEGACY_CODEX'?driver.invoke({name:tool,arguments:args,operation_id:id()}):driver.invoke(token,{name:tool,arguments:args,operation_id:id()});
   const catalog=harness==='LEGACY_CODEX'?driver.catalog():driver.catalog(token);assert.equal(new Set(catalog.tools.map(t=>t.name)).size,catalog.tools.length);assert.ok(catalog.tools.some(t=>t.name===name));assert.ok(!catalog.tools.some(t=>t.name==='teacher_propose_goal_draft'||t.name==='teacher_propose_capabilities')); assert.deepEqual(Object.keys(catalog.tools.find(t=>t.name===name).inputSchema.properties).sort(),['action','expected_revision','feedback','proposal_id']);
   if(harness==='DSH')assert.throws(()=>invoke(name),/先读取/);
   assert.equal(invoke('teacher_get_context').planning_chat_instructions,planningChatPrompt);
   assert.equal(invoke(name,{job_id:'foreign',lease_token:'forged',content:'bad'}).stage,'BLOCKED');
   invoke('teacher_reply',{content:'请先补充专业功能配置。'});
 };
 const spawnProcess=(_exe,_args,opts)=>{
  if(harness==='DSH')return acpMemoryProcess(opts,{onPrompt:({prompt,token})=>exercise(prompt,token),onComplete:finished,onError:error=>{observedError=error;finished();}});
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();let prompt='';child.stdin.on('data',data=>prompt+=data);child.kill=()=>child.emit('close',1);child.stdin.on('finish',()=>setImmediate(()=>{try{exercise(prompt,opts.env.TEACHER_HOST_TOKEN);}catch(error){observedError=error;}finally{child.emit('close',0);finished();}}));return child;
 };
 if(harness==='LEGACY_CODEX'){s.hostConfig.save({enabled:true});driver=codexHost(s,{dataDir:dir,baseUrl:()=>'',spawnProcess,intervalMs:1e9});}
 else{s.agents.configure({role:'chat',mode:'MCP',harness,executable:process.execPath,...(harness==='DSH'?{model:'custom/model'}:{})});driver=harnessHost(s,{dataDir:dir,baseUrl:()=>'',spawnProcess,readDshModel:()=>null,intervalMs:1e9});}
 t.after(async()=>{await driver.stop();s.db.close();rmSync(dir,{recursive:true,force:true});});
 const job=s.send(g.conversation.id,'按前面目标开始正式制定计划',id());await driver.tick();await done;if(observedError)throw observedError;assert.equal(calls,1);assert.equal(s.messages(g.conversation.id).at(-1).content,'请先补充专业功能配置。');
});
