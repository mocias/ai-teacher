import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {createStore,id} from '../server/store.mjs';
import {startServer} from '../server/index.mjs';
import {agentInvoke} from '../server/agent-mcp.mjs';
import {dshModelOptions} from '../public/dsh-model-picker.js';
const catalog={models:[{id:'campus/a',provider:'campus',model:'a',name:'A',provider_name:'Campus'},{id:'campus/smart/b',provider:'campus',model:'smart/b',name:'B',provider_name:'Campus'}],default_model:'campus/a',source:'Desktop'};
function setup(s){s.agents.dshModels.setCatalogReader(()=>catalog);s.agents.configure({role:'master',mode:'MCP',harness:'DSH',model:'campus/a'});return s.agents.conversation().conversation_id;}
test('conversation choices are independent, survive restart, freeze queued jobs, and retry uses the current choice',t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-model-choice-')),file=join(dir,'teacher.sqlite');let s=createStore(file);t.after(()=>{s.db.close();rmSync(dir,{recursive:true,force:true});});const cid=setup(s);
 s.agents.configure({role:'chat',mode:'MCP',harness:'DSH',model:'campus/a'});const other=s.createGoal({title:'Independent',domain:'test'}).conversation.id;
 s.agents.dshModels.save(cid,'campus/smart/b');const first=s.send(cid,'first',id());s.models.tag(first.job_id);
 s.agents.dshModels.save(cid,'campus/a');const second=s.send(cid,'second',id());s.models.tag(second.job_id);
 const route=s.agents.route('master'),snapshot=job_id=>s.agents.dshModels.forJob({id:job_id,conversation_id:cid},route).model;
 assert.equal(snapshot(first.job_id),'campus/smart/b');assert.equal(snapshot(second.job_id),'campus/a');assert.equal(s.agents.dshModels.get(other),'');
 assert.equal(s.agents.dshModels.forJob({id:first.job_id,conversation_id:cid},{harness:'CODEX',model:'codex-model'}).model,'codex-model','a saved DSH choice must not override another harness');
 s.agents.retry({job_id:first.job_id});assert.equal(snapshot(first.job_id),'campus/a');
 assert.throws(()=>s.agents.dshModels.save(cid,'not-configured/model'),/列表/);assert.throws(()=>s.agents.dshModels.save('missing','campus/a'),/不存在/);
 s.agents.dshModels.save(cid,'');assert.equal(s.agents.dshModels.get(cid),'');s.agents.dshModels.save(cid,'campus/smart/b');
 s.db.close();s=createStore(file);assert.equal(s.agents.dshModels.get(cid),'campus/smart/b');assert.equal(s.messages(cid).length,2);assert.ok(readdirSync(join(dir,'backups')).some(f=>f.startsWith('before-dsh-model-picker-')));
});
test('main agent can discover and propose DSH models through its actual strict tool schema',t=>{
 const s=createStore(':memory:');t.after(()=>s.db.close());const cid=setup(s),sent=s.send(cid,'配置不同 DSH 模型',id());s.models.tag(sent.job_id);const claim=s.claim('DSH',cid,'MCP','master'),args={job_id:claim.job.id,lease_token:claim.job.lease_token};
 const configuration=agentInvoke(s,'master','teacher_get_agent_configuration',args);assert.equal(configuration.dsh_models.models.length,2);
 const proposal=agentInvoke(s,'master','teacher_propose_agent_configuration',{...args,revision:configuration.revision,summary:'选择已有模型',plan:{routes:[{role:'chat',mode:'MCP',harness:'DSH',model:'campus/smart/b'},{role:'reading',mode:'MCP',harness:'DSH',model:'campus/a'}]},request_id:id()});
 assert.equal(s.agents.route('chat').mode,'UNCONFIGURED');s.agents.decide({id:proposal.id,accept:true,request_id:id()});assert.equal(s.agents.route('chat').model,'campus/smart/b');assert.equal(s.agents.route('reading').harness,'DSH');
 assert.throws(()=>agentInvoke(s,'master','teacher_propose_agent_configuration',{...args,revision:s.agents.state().revision,summary:'unknown',plan:{routes:[{role:'chat',mode:'MCP',harness:'DSH',model:'invented/model'}]},request_id:id()}),/列表/);
});
test('catalog and selection HTTP routes require the user session; selection never starts a request',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-model-api-')),home=join(dir,'dsh');mkdirSync(join(home,'profiles','desktop'),{recursive:true});writeFileSync(join(home,'profiles','desktop','cordis.patch.yml'),JSON.stringify([{id:'agent-default-model',config:{provider:'campus',model:'a'}},{id:'llm-pi-ai',config:{providers:{campus:{apiKey:'never-expose',models:[{id:'a'},{id:'smart/b'}]}}}}]));
 const app=startServer({port:0,dataDir:join(dir,'data'),harnessOptions:{intervalMs:1e9,dshSourceHome:home},executorOptions:{intervalMs:1e9},hostOptions:{intervalMs:1e9}});await once(app.server,'listening');t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});const base='http://127.0.0.1:'+app.server.address().port;
 app.store.agents.configure({role:'master',mode:'MCP',harness:'DSH'});const cid=app.store.agents.conversation().conversation_id;
 assert.equal((await fetch(base+'/api/agents/dsh-models')).status,401);assert.equal((await fetch(base+'/api/agents/dsh-models',{headers:{Authorization:'Bearer '+app.token}})).status,401);
 const page=await fetch(base),cookie=page.headers.get('set-cookie').split(';')[0];const models=await fetch(base+'/api/agents/dsh-models',{headers:{Cookie:cookie}});const result=await models.json();assert.equal(result.models.length,2);assert.ok(!JSON.stringify(result).includes('never-expose'));
 const post=(value,extra={})=>fetch(base+'/api/agents/dsh-model',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',...extra},body:JSON.stringify(value)});
 assert.equal((await post({conversation_id:cid,model:'campus/smart/b'})).status,200);assert.equal(app.store.agents.dshModels.get(cid),'campus/smart/b');assert.equal(app.store.agents.state().runs.length,0);
 assert.equal((await post({conversation_id:cid,model:'campus/a'},{Authorization:'Bearer '+app.token})).status,403);
 // Reading and assessment queues can be created before routing sync: freeze them before changing the preference.
 const queued=app.store.send(cid,'queued before changing selection',id());assert.equal((await post({conversation_id:cid,model:'campus/a'})).status,200);
 assert.equal(app.store.db.prepare('SELECT model FROM dsh_job_models WHERE job_id=?').get(queued.job_id).model,'campus/smart/b');
});
test('picker escapes model labels and preserves a removed selection visibly',()=>{
 const html=dshModelOptions({models:[{id:'p/<bad>',provider:'p',model:'<bad>',name:'<script>oops</script>',provider_name:'<unsafe>'}]},'gone/old');assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/gone\/old.*selected/);assert.match(html,/未在列表中/);
});
