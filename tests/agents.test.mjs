import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore,id} from '../server/store.mjs';
import {modelExecutor} from '../server/model-executor.mjs';
import {agentInvoke,agentCatalog} from '../server/agent-mcp.mjs';
import {startServer} from '../server/index.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {once} from 'node:events';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const response=message=>new Response(JSON.stringify({choices:[{finish_reason:message.tool_calls?'tool_calls':'stop',message}]}));
const call=(name,args)=>({id:id(),type:'function',function:{name,arguments:JSON.stringify(args)}});
function setup(t){const s=createStore(':memory:');t.after(()=>s.db.close());return s;}
function profile(s,name='main'){return s.models.save({name,base_url:'https://example.test/v1',model:name,key:'credential-never-in-context',options:{}});}
function main(s,mode='MCP'){s.agents.configure({role:'master',mode,...(mode==='API'?{profile_id:profile(s).id}:{})});}
function message(s,kind='chat'){const g=s.createGoal({title:'测试',domain:'测试'}),j=s.send(g.conversation.id,'请处理',id());s.models.tag(j.job_id,kind);return {...g,...j};}
const claim=(s,role='master')=>agentInvoke(s,role,'teacher_claim_message',{});
const args=c=>({job_id:c.job.id,lease_token:c.job.lease_token,request_id:id()});

function guideMessage(s){const conversation=s.agents.conversation(),sent=s.send(conversation.conversation_id,'介绍系统并帮助配置',id());s.models.tag(sent.job_id);return {...sent,conversation:{id:conversation.conversation_id}};}
function materialMessage(s){const g=s.createGoal({title:'资料目标',domain:'测试'}),r=s.resource({goal_id:g.goal.id,title:'材料'}),c=s.learning.material({resource_id:r.id,content:'缓存复用正文',scope:'全文'}),j=s.send(g.conversation.id,'请分析资料',id());s.models.tag(j.job_id,'material',c.id);return {...g,...j,content_id:c.id};}

test('main API only introduces the project and configures features; unconfigured work never reaches it',async t=>{
 const s=setup(t);main(s,'API');const seen=[];const x=modelExecutor(s,{intervalMs:1000000,fetcher:async(_u,o)=>{seen.push(JSON.parse(o.body));return response({content:'这里可以配置不同学习功能的 AI。'});}});t.after(()=>x.stop());
 const work=message(s,'capabilities');const onboarding=s.study.onboarding({action:'start',request_id:id()});await x.tick();assert.equal(seen.length,0);assert.equal(s.claim('legacy').job,null);
 assert.equal(s.models.state().tasks.find(t=>t.job_id===work.job_id).mode,'UNCONFIGURED');assert.equal(s.models.state().tasks.at(-1).agent_role,'onboarding');
 const guide=guideMessage(s);await x.tick();assert.equal(seen.length,1);assert.equal(s.messages(guide.conversation.id).at(-1).role,'assistant');assert.equal(s.messages(work.conversation.id).length,1);assert.equal(s.messages(onboarding.conversation_id).length,1);
 assert.deepEqual(seen[0].tools.map(t=>t.function.name).sort(),['teacher_get_agent_configuration','teacher_propose_agent_configuration']);assert.ok(!JSON.stringify(seen).includes('credential-never-in-context'));assert.ok(!JSON.stringify(seen).includes(work.conversation.id));
});

test('functional API calls go straight to the configured model, with no main-agent call or fallback',async t=>{
 const s=setup(t);main(s,'API');const p=profile(s,'material-model');s.agents.configure({role:'material',mode:'API',profile_id:p.id});const work=materialMessage(s),seen=[];
 const x=modelExecutor(s,{intervalMs:1000000,fetcher:async(_u,o)=>{const body=JSON.parse(o.body);seen.push(body);if(!body.messages.some(m=>m.role==='tool'))return response({tool_calls:[call('teacher_read_material',{content_id:work.content_id})]});return response({content:'资料模型已读取正文'});}});t.after(()=>x.stop());
 await x.tick();assert.deepEqual(seen.map(p=>p.model),['material-model','material-model']);assert.equal(s.models.state().tasks[0].agent_role,'material');assert.equal(s.messages(work.conversation.id).at(-1).content,'资料模型已读取正文');assert.ok(!seen[0].tools.some(t=>t.function.name.includes('configuration')));assert.equal(s.agents.state().routes.find(r=>r.role==='chat').mode,'UNCONFIGURED');
});

test('main and module MCP queues are independent; main cannot claim or read learning work',t=>{
 const s=setup(t);main(s);s.agents.configure({role:'capabilities',mode:'MCP'});const first=message(s,'capabilities'),later=s.send(first.conversation.id,'后续问题',id());s.models.tag(later.job_id,'capabilities');assert.equal(claim(s).job,null);
 const c=claim(s,'capabilities');assert.equal(c.job.id,first.job_id);assert.equal(c.context.messages.length,1);assert.equal(claim(s,'capabilities').job,null);
 assert.throws(()=>agentInvoke(s,'master','teacher_get_context',args(c)),/不属于/);assert.throws(()=>agentInvoke(s,'master','teacher_propose_capabilities',args(c)),/不允许/);assert.throws(()=>agentInvoke(s,'master','teacher_delegate_task',args(c)),/不允许/);
 agentInvoke(s,'capabilities','teacher_propose_capabilities',{...args(c),items:[{title:'能力',kind:'CORE',requirements:[{node:'知识点',description:'能够解释'}]}]});agentInvoke(s,'capabilities','teacher_reply',{...args(c),content:'能力方案待确认'});assert.equal(claim(s,'capabilities').job.id,later.job_id);assert.equal(claim(s).job,null);
 const intro=guideMessage(s),mainClaim=claim(s);assert.equal(mainClaim.job.id,intro.job_id);assert.ok(mainClaim.context.orchestration);assert.equal(mainClaim.context.resources.length,0);assert.ok(!agentCatalog('master').some(t=>t.name==='teacher_read_material'));
});

test('main proposes feature connections, user confirms atomically, stale proposals and module config writes rejected',t=>{
 const s=setup(t);main(s);guideMessage(s);const c=claim(s),a=args(c),p=s.agents.propose({...a,revision:s.agents.state().revision,summary:'配置资料模型',plan:{routes:[{role:'material',mode:'API',connection:{name:'资料',model:'material',base_url:'https://example.test/v1'}},{role:'review',mode:'MCP'}]}});
 assert.equal(s.agents.route('material').mode,'UNCONFIGURED');s.agents.decide({id:p.id,accept:true,keys:{material:'new-private-key'},request_id:id()});assert.equal(s.agents.route('material').mode,'API');assert.equal(s.agents.route('review').mode,'MCP');assert.ok(!JSON.stringify(s.overview()).includes('new-private-key'));
 const second=s.agents.propose({...args(c),revision:s.agents.state().revision,summary:'待确认',plan:{routes:[]}});s.agents.configure({role:'chat',mode:'MCP'});assert.throws(()=>s.agents.decide({id:second.id,accept:true,request_id:id()}),/配置已更新/);assert.throws(()=>agentInvoke(s,'review','teacher_propose_agent_configuration',{}),/不允许/);
});

test('sharing the main API profile requires explicit feature selection and keeps tools separate',async t=>{
 const s=setup(t);main(s,'API');const j=message(s,'chat'),p=s.agents.route('master').profile_id;assert.equal(s.models.state().tasks[0].mode,'UNCONFIGURED');s.agents.configure({role:'chat',mode:'API',profile_id:p});assert.equal(s.models.state().tasks[0].mode,'UNCONFIGURED');s.agents.retry({job_id:j.job_id});
 const seen=[];const x=modelExecutor(s,{intervalMs:1000000,fetcher:async(_u,o)=>{seen.push(JSON.parse(o.body));return response({content:'普通对话回复'});}});t.after(()=>x.stop());await x.tick();assert.equal(seen[0].model,'main');assert.equal(seen[0].tools,undefined);assert.equal(s.models.state().tasks[0].agent_role,'chat');assert.throws(()=>s.agents.retry({job_id:j.job_id,to_master:true}),/不能交给/);
});

test('scoped material MCP cannot read foreign material and rejects expired or cancelled leases',t=>{
 const s=setup(t);s.agents.configure({role:'material',mode:'MCP'});const j=materialMessage(s),foreign=s.createGoal({title:'其他',domain:'其他'}),r=s.resource({title:'私有材料',goal_id:foreign.goal.id}),body=s.learning.material({resource_id:r.id,content:'私有正文',scope:'全文'}),c=claim(s,'material');
 assert.throws(()=>agentInvoke(s,'material','teacher_read_material',{...args(c),content_id:body.id}),/不属于/);assert.throws(()=>agentInvoke(s,'material','teacher_analyze_material',{...args(c),content_id:j.content_id,status:'ANALYZED',summary:'未读就分析'}),/先读取/);
 s.db.prepare('UPDATE jobs SET lease_until=0 WHERE id=?').run(c.job.id);assert.throws(()=>agentInvoke(s,'material','teacher_get_context',args(c)),/失效/);const recovered=claim(s,'material');assert.equal(recovered.job.id,j.job_id);s.cancel(j.job_id);assert.throws(()=>agentInvoke(s,'material','teacher_reply',{...args(recovered),content:'迟到'}),/失效/);
});

test('failed feature API switches to its own MCP, never to main; old credentials are revoked',async t=>{
 const s=setup(t);main(s,'API');s.agents.configure({role:'chat',mode:'API',profile_id:profile(s,'chat').id});const j=message(s);const x=modelExecutor(s,{intervalMs:1000000,fetcher:async()=>new Response('error',{status:503})});t.after(()=>x.stop());await x.tick();assert.equal(s.models.state().tasks[0].blocked,1);
 assert.throws(()=>s.agents.retry({job_id:j.job_id,to_master:true}),/不能交给/);s.agents.configure({role:'chat',mode:'MCP'});const old=s.agents.token('chat').token;s.agents.retry({job_id:j.job_id});assert.equal(claim(s).job,null);const c=claim(s,'chat');assert.equal(c.job.id,j.job_id);agentInvoke(s,'chat','teacher_reply',{...args(c),content:'恢复成功'});
 s.agents.configure({role:'chat',mode:'UNCONFIGURED'});s.agents.configure({role:'chat',mode:'MCP'});assert.equal(s.agents.authenticate('chat',old),false);
});

test('configuration confirmation is idempotent and rolls back the entire invalid plan',t=>{
 const s=setup(t);main(s);guideMessage(s);const c=claim(s),p=s.agents.propose({...args(c),revision:s.agents.state().revision,summary:'两个新连接',plan:{routes:[{role:'material',mode:'API',connection:{name:'A',model:'a',base_url:'https://example.test/v1'}},{role:'roadmap',mode:'API',connection:{name:'B',model:'b',base_url:'https://example.test/v1'}}]}}),revision=s.agents.state().revision;
 assert.throws(()=>s.agents.decide({id:p.id,accept:true,keys:{roadmap:'bad\nkey'},request_id:id()}),/Key/);assert.equal(s.models.state().profiles.length,0);assert.equal(s.agents.route('material').mode,'UNCONFIGURED');assert.equal(s.agents.state().revision,revision);
 const input={id:p.id,accept:true,request_id:id()};s.agents.decide(input);s.agents.decide(input);assert.equal(s.models.state().profiles.length,2);assert.equal(s.agents.state().revision,revision+1);
});

test('reading goes directly to its own MCP, preserves snapshots and grants no teaching or configuration tools',t=>{
 const s=setup(t);main(s);s.agents.configure({role:'reading',mode:'MCP'});const r=s.resource({title:'自主阅读'}),chat=s.study.open({resource_id:r.id});s.study.ask({conversation_id:chat.conversation_id,content:'解释选文',page_content:'当前正文',request_id:id()});s.study.ask({conversation_id:chat.conversation_id,content:'未来问题',page_content:'未来页面',request_id:id()});assert.equal(claim(s).job,null);
 const c=claim(s,'reading');assert.equal(c.task.module,'reading');assert.equal(c.context.study.snapshots.length,1);assert.ok(!JSON.stringify(c.context).includes('未来页面'));assert.deepEqual(agentCatalog('reading').map(t=>t.name).sort(),['teacher_claim_message','teacher_get_context','teacher_renew_lease','teacher_reply'].sort());agentInvoke(s,'reading','teacher_reply',{...args(c),content:'阅读解释'});assert.equal(s.overview().evidence.length,0);
});

test('upgrade retires main fallback, preserves data and blocks interrupted work pending explicit retry',()=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-direct-routing-')),file=join(dir,'teacher.sqlite');let s=createStore(file);
 try{main(s,'API');s.agents.configure({role:'capabilities',mode:'MCP'});const work=message(s,'capabilities'),reading=s.study.open({resource_id:s.resource({title:'阅读资料'}).id}),q=s.study.ask({conversation_id:reading.conversation_id,content:'旧阅读任务',page_content:'正文',request_id:id()});s.models.sync();
  s.db.prepare("UPDATE job_execution SET agent_role='master',mode='API',profile_id=?").run(s.agents.route('master').profile_id);s.db.prepare("UPDATE job_execution SET module='chat' WHERE job_id=?").run(q.job_id);s.db.prepare("UPDATE jobs SET status='RUNNING',lease_token='old-lease',lease_until=? WHERE id=?").run(Date.now()+100000,q.job_id);
  s.db.exec("INSERT INTO agent_routes(role,mode) VALUES('reading','INHERIT'); ALTER TABLE agent_settings DROP COLUMN routing_version;");s.db.close();s=createStore(file);
  const task=s.models.state().tasks.find(t=>t.job_id===work.job_id),rt=s.models.state().tasks.find(t=>t.job_id===q.job_id);assert.equal(task.agent_role,'capabilities');assert.equal(task.mode,'MCP');assert.equal(rt.agent_role,'reading');assert.equal(rt.mode,'UNCONFIGURED');assert.equal(rt.blocked,1);assert.equal(s.agents.route('reading').mode,'UNCONFIGURED');assert.equal(s.claim('main-api',undefined,'API').job,null);assert.equal(s.messages(work.conversation.id).length,1);assert.ok(readdirSync(join(dir,'backups')).some(f=>f.startsWith('before-direct-agent-routing-')));
 }finally{s.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('real HTTP and stdio scoped MCP, independent tokens, rotation, user-only confirmation and restart',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-agents-'));let app=startServer({port:0,dataDir:dir,executorOptions:{intervalMs:1000000}});await once(app.server,'listening');let base='http://127.0.0.1:'+app.server.address().port;
 const clients=[];t.after(async()=>{for(const c of clients)await c.close();await app.close();rmSync(dir,{recursive:true,force:true});});
 for(const path of ['/agents.js','/agents.html','/agent-chat.js'])assert.equal((await fetch(base+path)).status,200);
 const cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0];const post=async(path,data,auth)=>fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,...(auth?{Authorization:'Bearer '+auth}:{})},body:JSON.stringify(data)});
 assert.equal((await post('agents/configure',{role:'master',mode:'MCP'})).status,200);const token=(await(await post('agents/token',{role:'master'})).json()).token;
 await post('agents/configure',{role:'material',mode:'MCP'});const other=(await(await post('agents/token',{role:'material'})).json()).token;
 assert.equal((await post('agents/catalog',{role:'material'},token)).status,401);assert.equal((await post('agents/decide',{id:'x',accept:true},token)).status,403);assert.equal((await post('agents/token',{role:'master'},token)).status,403);
 const c=new Client({name:'main-test',version:'1'});await c.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp/agents/master'),{requestInit:{headers:{Authorization:'Bearer '+token}}}));clients.push(c);assert.ok((await c.listTools()).tools.some(t=>t.name==='teacher_propose_agent_configuration'));assert.ok(!(await c.listTools()).tools.some(t=>t.name==='teacher_delegate_task'));
 const specialist=new Client({name:'specialist-test',version:'1'});await specialist.connect(new StdioClientTransport({command:process.execPath,args:[resolve('scripts/agent-mcp.mjs')],env:{...process.env,TEACHER_URL:base,TEACHER_AGENT_ROLE:'material',TEACHER_TOKEN:other},stderr:'pipe'}));clients.push(specialist);assert.ok(!(await specialist.listTools()).tools.some(t=>t.name==='teacher_propose_agent_configuration'));
 const j=guideMessage(app.store);const claimed=JSON.parse((await c.callTool({name:'teacher_claim_message',arguments:{}})).content[0].text);assert.equal(claimed.job.id,j.job_id);
 const rotated=(await(await post('agents/token',{role:'master'})).json()).token;assert.notEqual(rotated,token);assert.equal((await post('agents/catalog',{role:'master'},token)).status,401);assert.equal((await post('agents/catalog',{role:'material'},other)).status,200);
 const exported=await(await fetch(base+'/api/export',{headers:{Cookie:cookie}})).json();assert.equal(exported.agents,undefined);assert.ok(!JSON.stringify(app.store.overview()).includes(rotated));
 for(const client of clients)await client.close();clients.length=0;await app.close();app=startServer({port:0,dataDir:dir,executorOptions:{intervalMs:1000000}});await once(app.server,'listening');assert.equal(app.store.agents.authenticate('master',rotated),true);assert.equal(app.store.messages(j.conversation.id).length,1);assert.ok(readdirSync(join(dir,'backups')).some(f=>f.startsWith('before-agents-')));
});
