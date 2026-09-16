import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {once,EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createStore,id} from '../server/store.mjs';
import {modelExecutor} from '../server/model-executor.mjs';
import {codexHost} from '../server/codex-host.mjs';
import {startServer} from '../server/index.mjs';
const draft={direction:'理解单卡推理',background:'会 Python',level:'能独立实践',outcome:'运行并修改简化推理引擎',exclusions:'多机部署'};
const propose=(s,c,extra={})=>s.discovery.propose({conversation_id:c,revision:s.discovery.get(c).revision,draft,summary:'先掌握单卡推理，基础来自用户自述。',request_id:id(),...extra});
function setup(t){const s=createStore(':memory:');t.after(()=>s.db.close());return s;}
test('discussion stays outside goals, protects manual fields, and confirms exactly once with provenance',t=>{
 const s=setup(t),c=s.discovery.create({request_id:id()}).conversation_id;
 const j=s.send(c,'想了解大模型推理',id());assert.equal(s.overview().goals.length,0);
 const claim=s.claim('test',c);assert.equal(claim.job.id,j.job_id);assert.equal(claim.context.goal,null);
 let d=propose(s,c);assert.equal(d.draft.direction,draft.direction);assert.throws(()=>s.discovery.confirm({conversation_id:c,revision:d.revision,request_id:id()}),/等待/);
 s.reply({job_id:j.job_id,lease_token:claim.job.lease_token,content:'这份草案是否符合你的预期？',request_id:id()});
 d=s.discovery.save({conversation_id:c,revision:d.revision,draft:{level:'深入原理'}});const oldRevision=d.revision;
 d=propose(s,c);assert.equal(d.draft.level,'深入原理');assert.equal(d.suggestion.level,draft.level);
 assert.throws(()=>propose(s,c,{revision:oldRevision}),/已有更新/);
 d=s.discovery.decide({conversation_id:c,revision:d.revision,accept:false});assert.equal(d.draft.level,'深入原理');
 const created=s.discovery.confirm({conversation_id:c,revision:d.revision,request_id:id()});assert.deepEqual(s.discovery.confirm({conversation_id:c,revision:d.revision,request_id:id()}),created);assert.equal(s.overview().goals.length,1);
 const context=s.context(created.conversation_id);assert.equal(context.origin.conversation_id,c);assert.match(context.goal.scope,/深入原理/);assert.match(context.messages[0].content,/多机部署/);assert.equal(context.evidence.length,0);assert.equal(s.messages(c).length,2);
 assert.throws(()=>s.send(c,'继续',id()),/只读/);assert.throws(()=>propose(s,c),/已创建/);
});
test('discovery background contains only goal summaries; sessions and drafts remain separate',t=>{
 const s=setup(t),g=s.createGoal({title:'已有目标',domain:'测试'});s.saveNote({goal_id:g.goal.id,title:'private-note',content:'SECRET_NOTE'});s.send(g.conversation.id,'SECRET_CHAT',id());s.resource({goal_id:g.goal.id,title:'SECRET_RESOURCE',role:'REFERENCE'});
 s.db.prepare('INSERT INTO profiles VALUES(?,?,?)').run(g.goal.id,'会 Python','now');
 const a=s.discovery.create({request_id:id()}).conversation_id,b=s.discovery.create({request_id:id()}).conversation_id;propose(s,a);s.discovery.saveInput({conversation_id:a,content:'未发送的问题'});
 const context=JSON.stringify(s.context(a));for(const secret of ['SECRET_NOTE','SECRET_CHAT','SECRET_RESOURCE'])assert.ok(!context.includes(secret));assert.match(context,/会 Python/);assert.deepEqual(s.discovery.get(b).draft,{});assert.equal(s.discovery.state().find(d=>d.conversation_id===a).unsent,'未发送的问题');
 assert.throws(()=>s.models.validateTask(a,'roadmap'),/普通对话/);
});
test('API chat routing supports discovery tools, binds conversation, and saves a visible reply',async t=>{
 const s=setup(t),c=s.discovery.create({request_id:id()}).conversation_id,other=s.discovery.create({request_id:id()}).conversation_id;let calls=0;
 const x=modelExecutor(s,{intervalMs:1000000,fetcher:async(_url,opts)=>{const body=JSON.parse(opts.body);assert.equal(body.model,'chat-model');assert.deepEqual(body.tools.map(t=>t.function.name),['teacher_get_context','teacher_propose_goal_draft']);calls++;return new Response(JSON.stringify({choices:[{finish_reason:calls===1?'tool_calls':'stop',message:calls===1?{tool_calls:[{id:'draft-call',type:'function',function:{name:'teacher_propose_goal_draft',arguments:JSON.stringify({conversation_id:other,revision:0,draft,summary:'单卡实践'})}}]}:{content:'草案已经整理好，可以直接编辑。'}}]}));}});t.after(()=>x.stop());
 const p=s.models.save({name:'普通对话',base_url:'https://example.com/v1',model:'chat-model',key:''});s.models.routes({routes:[{module:'chat',profile_id:p.id}]});s.models.enabled(true);s.send(c,'我想学推理',id());await x.tick();
 assert.equal(s.models.state().runs[0].status,'COMPLETED');assert.equal(s.discovery.get(c).draft.direction,draft.direction);assert.deepEqual(s.discovery.get(other).draft,{});assert.match(s.messages(c).at(-1).content,/草案/);assert.equal(s.overview().goals.length,0);
});
test('Codex discovery catalog is scoped and draft proposal requires explicit reply',async t=>{
 const s=setup(t),folder=mkdtempSync(join(tmpdir(),'teacher-discovery-host-')),c=s.discovery.create({request_id:id()}).conversation_id;let x,checked=false;
 x=codexHost(s,{dataDir:folder,baseUrl:()=>'',intervalMs:1000000,spawnProcess:()=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',1);child.stdin.on('finish',()=>setImmediate(()=>{try{const invoke=(name,args={})=>x.invoke({name,arguments:args,operation_id:id()});assert.deepEqual(x.catalog().tools.map(t=>t.name),['teacher_get_context','teacher_reply','teacher_propose_goal_draft']);assert.throws(()=>invoke('teacher_read_material',{content_id:'foreign'}),/不属于/);invoke('teacher_propose_goal_draft',{revision:0,draft,summary:'草案'});invoke('teacher_reply',{content:'请确认目标草案。'});checked=true;}finally{child.emit('close',0);}}));return child;}});t.after(async()=>{await x.stop();rmSync(folder,{recursive:true,force:true});});s.hostConfig.save({enabled:true});s.send(c,'我想学习推理',id());await x.tick();assert.equal(checked,true);assert.equal(s.hostConfig.state().runs[0].status,'COMPLETED');assert.equal(s.overview().goals.length,0);
});
test('existing database upgrades without losing references, and unsent input survives restart',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'teacher-discovery-migrate-')),file=join(folder,'teacher.sqlite');t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const db=new DatabaseSync(file);db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));db.prepare('INSERT INTO goals VALUES(?,?,?,?,?,?)').run('old','旧目标','领域','','INITIALIZING','now');db.prepare('INSERT INTO conversations VALUES(?,?,?,?,?)').run('old-chat','old','旧对话','PLANNING','now');db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?)').run('old-message','old-chat','user','旧消息','now',null,null);db.close();
 let s=createStore(file);assert.equal(s.messages('old-chat')[0].content,'旧消息');assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(),[]);const c=s.discovery.create({request_id:id()}).conversation_id;propose(s,c);s.discovery.saveInput({conversation_id:c,content:'继续讨论'});s.db.close();s=createStore(file);assert.equal(s.discovery.get(c).draft.direction,draft.direction);assert.equal(s.discovery.state()[0].unsent,'继续讨论');assert.equal(s.overview().goals.length,1);assert.equal(readdirSync(join(folder,'backups')).filter(n=>n.startsWith('before-goal-discussions-')).length,1);s.db.close();
});
test('discussion user actions require browser session and reject agent credentials',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'teacher-discussion-http-')),app=startServer({port:0,dataDir:folder});await once(app.server,'listening');t.after(async()=>{await app.close();rmSync(folder,{recursive:true,force:true});});const base='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(base+'/')).headers.get('set-cookie').split(';')[0];const body=JSON.stringify({request_id:id()});
 assert.equal((await fetch(base+'/api/discussions',{method:'POST',headers:{'Content-Type':'application/json'},body})).status,401);
 assert.equal((await fetch(base+'/api/discussions',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,Authorization:'Bearer '+app.token},body})).status,403);
 assert.equal((await fetch(base+'/api/discussions',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body})).status,200);
});
