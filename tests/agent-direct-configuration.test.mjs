import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore,id} from '../server/store.mjs';
import {agentInvoke,agentCatalog} from '../server/agent-mcp.mjs';
import {modelExecutor} from '../server/model-executor.mjs';
import {startServer} from '../server/index.mjs';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
function setup(t){const s=createStore(':memory:');t.after(()=>s.db.close());s.agents.dshModels.setCatalogReader(()=>({models:[{id:'local/one'}],default_model:'local/one'}));s.agents.configure({role:'master',mode:'MCP',harness:'DSH',executable:'C:/DSH/host.exe'});const cid=s.agents.conversation().conversation_id;const sent=s.send(cid,'请直接把各功能设为 DSH',id());s.models.tag(sent.job_id);const c=s.claim('master',cid,'MCP','master');return {s,c,args:{job_id:c.job.id,lease_token:c.job.lease_token,request_id:id(),revision:s.agents.state().revision,summary:'配置 DSH',routes:[{role:'chat',mode:'MCP',harness:'DSH',model:'local/one'},{role:'reading',mode:'MCP',harness:'DSH',model:'local/one'}]}};}
test('main Agent directly sets module connections through its real tool; atomic, idempotent and reversible',t=>{
 const {s,args}=setup(t);const before=s.agents.route('chat');const result=agentInvoke(s,'master','teacher_set_agent_configuration',args);
 assert.equal(result.status,'APPLIED');assert.equal(s.agents.route('chat').model,'local/one');assert.equal(s.agents.route('reading').executable,'C:/DSH/host.exe');assert.equal(s.agents.state().proposals.length,0);
 assert.deepEqual(agentInvoke(s,'master','teacher_set_agent_configuration',args),result);assert.equal(s.agents.state().configuration_changes.length,1);
 s.agents.undoConfiguration({id:result.change_id,request_id:id()});assert.equal(s.agents.route('chat').mode,before.mode);assert.ok(s.agents.state().configuration_changes[0].reverted_at);
});
test('direct configuration rejects foreign roles, credentials, new connections, invalid models and stale revisions without partial writes',t=>{
 const {s,args}=setup(t);assert.ok(!agentCatalog('chat').some(t=>t.name==='teacher_set_agent_configuration'));
 assert.throws(()=>agentInvoke(s,'chat','teacher_set_agent_configuration',args),/不允许/);
 for(const extra of [{role:'master',mode:'MCP',harness:'DSH'},{role:'review',mode:'MCP',harness:'DSH',model:'absent/model'},{role:'review',mode:'API',profile_id:'missing'}]){
  assert.throws(()=>agentInvoke(s,'master','teacher_set_agent_configuration',{...args,routes:[args.routes[0],extra]}));assert.equal(s.agents.route('chat').mode,'UNCONFIGURED');
 }
 assert.throws(()=>agentInvoke(s,'master','teacher_set_agent_configuration',{...args,routes:[{...args.routes[0],executable:'C:/arbitrary.exe'}]}));
 assert.throws(()=>agentInvoke(s,'master','teacher_set_agent_configuration',{...args,routes:[{role:'chat',mode:'API',connection:{name:'new',base_url:'https://example.test',model:'m'}}]}));
 s.agents.configure({role:'review',mode:'MCP',harness:'CODEX'});assert.throws(()=>agentInvoke(s,'master','teacher_set_agent_configuration',args),/配置已变化/);
});
test('active feature runs cannot be interrupted by direct settings; cancelled main jobs lose their write capability',t=>{
 const {s,args}=setup(t);s.agents.configure({role:'reading',mode:'MCP',harness:'DSH'});const revision=s.agents.state().revision;
 s.db.prepare('INSERT INTO harness_runs(id,job_id,role,harness,status,created_at) VALUES(?,?,?,?,?,?)').run(id(),args.job_id,'reading','DSH','RUNNING',new Date().toISOString());
 assert.throws(()=>agentInvoke(s,'master','teacher_set_agent_configuration',{...args,revision}),/执行中/);assert.equal(s.agents.route('chat').mode,'UNCONFIGURED');
 s.cancel(args.job_id);assert.throws(()=>agentInvoke(s,'master','teacher_set_agent_configuration',{...args,revision}),/失效/);
});
test('API-backed main Agent sees and executes the new setting tool and tells the user APPLIED',async t=>{
 const s=createStore(':memory:');t.after(()=>s.db.close());const p=s.models.save({name:'local',base_url:'http://127.0.0.1:9/v1',model:'mock',key:'',options:{}});s.agents.configure({role:'master',mode:'API',profile_id:p.id});const cid=s.agents.conversation().conversation_id;const sent=s.send(cid,'使用已有 API 连接设置普通对话',id());s.models.tag(sent.job_id);let count=0,beforeCalled=false;
 const x=modelExecutor(s,{intervalMs:1e9,beforeTool:async name=>{if(name==='teacher_set_agent_configuration')beforeCalled=true;},fetcher:async(_url,options)=>{
  const payload=JSON.parse(options.body);assert.ok(payload.tools.some(t=>t.function.name==='teacher_set_agent_configuration'));
  const message=count++===0?{role:'assistant',tool_calls:[{id:'set',type:'function',function:{name:'teacher_set_agent_configuration',arguments:JSON.stringify({revision:s.agents.state().revision,summary:'使用已有连接',routes:[{role:'chat',mode:'API',profile_id:p.id}]})}}]}:{role:'assistant',content:JSON.parse(payload.messages.at(-1).content).status};
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message}]}));
 }});t.after(()=>x.stop());await x.tick();assert.ok(beforeCalled);assert.equal(s.agents.route('chat').profile_id,p.id);assert.equal(s.messages(cid).at(-1).content,'APPLIED');
});
test('HTTP MCP direct setting is role scoped; undo is user-only and migration preserves records',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-direct-config-'));let app=startServer({port:0,dataDir:dir,executorOptions:{intervalMs:1e9},hostOptions:{intervalMs:1e9},harnessOptions:{intervalMs:1e9}});await once(app.server,'listening');t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0],s=app.store;
 s.agents.configure({role:'master',mode:'MCP',harness:'MANUAL'});const token=s.agents.token('master').token,cid=s.agents.conversation().conversation_id,sent=s.send(cid,'设置为 Codex',id());s.models.tag(sent.job_id);const c=s.claim('test',cid,'MCP','master');
 const result=await fetch(base+'/api/agents/tool',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({role:'master',name:'teacher_set_agent_configuration',arguments:{job_id:c.job.id,lease_token:c.job.lease_token,request_id:id(),revision:s.agents.state().revision,summary:'使用 Codex',routes:[{role:'chat',mode:'MCP',harness:'CODEX'}]}})});assert.equal(result.status,200);const applied=await result.json();assert.equal(applied.status,'APPLIED');
 const undo=auth=>fetch(base+'/api/agents/configuration/undo',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',...auth?{Authorization:'Bearer '+token}:{}},body:JSON.stringify({id:applied.change_id,request_id:id()})});assert.equal((await undo(true)).status,403);assert.equal((await undo(false)).status,200);s.cancel(c.job.id);
 await app.close();app=startServer({port:0,dataDir:dir,executorOptions:{intervalMs:1e9},hostOptions:{intervalMs:1e9},harnessOptions:{intervalMs:1e9}});await once(app.server,'listening');assert.equal(app.store.messages(cid).length,1);assert.equal(app.store.agents.state().configuration_changes.length,1);assert.ok(readdirSync(join(dir,'backups')).some(f=>f.startsWith('before-direct-configuration-')));
});
