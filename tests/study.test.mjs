import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore,id} from '../server/store.mjs';
import {modelExecutor} from '../server/model-executor.mjs';
import {limitStudyContext} from '../server/study.mjs';
const setup=t=>{const s=createStore(':memory:');t.after(()=>s.db.close());return s;};
const complete=(s,c,content='完成')=>{const x=s.claim('test',c);assert.ok(x.job);s.reply({job_id:x.job.id,lease_token:x.job.lease_token,content,request_id:id()});return x;};
test('reading is independent, shares resource progress and keeps evidence empty',t=>{
 const s=setup(t),a=s.study.open({url:'https://example.com/lesson#one',title:'课文'}),b=s.study.open({url:'https://example.com/lesson#two',title:'课文'});assert.equal(a.resource.id,b.resource.id);assert.equal(a.conversation_id,b.conversation_id);assert.equal(s.overview().goals.length,0);
 s.study.progress({resource_id:a.resource.id,location:'第二章',title:'课文',url:'https://example.com/lesson#two'});for(let i=0;i<2;i++){const g=s.createGoal({title:'目标'+i,domain:'学习'});s.study.link({resource_id:a.resource.id,goal_id:g.goal.id});}
 assert.equal(s.study.state().links.length,2);assert.equal(s.study.state().progress.length,1);assert.equal(s.study.state().progress[0].location,'第二章');assert.equal(s.overview().evidence.length,0);assert.equal(s.study.settings().profile,'');
 const msg=s.study.ask({conversation_id:a.conversation_id,content:'为什么？',page_content:'原文',selection:'一句话',request_id:id()});const x=complete(s,a.conversation_id);assert.equal(x.context.study.snapshots[0].message_id,msg.message_id);assert.equal(x.context.study.snapshots[0].content,'原文');assert.equal(s.overview().evidence.length,0);
 assert.throws(()=>s.models.validateTask(a.conversation_id,'roadmap'),/普通对话/);assert.throws(()=>s.study.propose({conversation_id:a.conversation_id}),/阅读行为/);
});
test('annotations preserve location and attach real notes without changing mastery',t=>{
 const s=setup(t),r=s.study.open({url:'https://example.com'});s.study.annotate({resource_id:r.resource.id,location:'第 3 页',quote:'text',kind:'highlight'});s.study.annotate({resource_id:r.resource.id,location:'第 3 页',quote:'text',kind:'note',note:'自己的理解'});assert.equal(s.study.annotations(r.resource.id)[1].note,'自己的理解');assert.equal(s.overview().notes.length,1);assert.equal(s.overview().evidence.length,0);
});
test('first use can skip, resume, revise by conversation and explicitly confirm with revision protection',t=>{
 const s=setup(t);assert.equal(s.study.settings().onboarding,'NEW');s.study.onboarding({action:'skip'});const c=s.study.onboarding({action:'start',request_id:id()}).conversation_id;assert.equal(s.study.settings().onboarding,'STARTED');complete(s,c);
 const a=s.study.propose({conversation_id:c,content:'会 Python',reason:'用户自述',revision:0,request_id:id()});assert.equal(s.study.settings().profile,'');const b=s.study.propose({conversation_id:c,content:'会 Python，偏好项目实践',reason:'用户修正',revision:0,request_id:id()});assert.throws(()=>s.study.confirm({id:a.id,accept:true,request_id:id()}),/已处理/);s.study.confirm({id:b.id,accept:true,request_id:id()});assert.equal(s.study.settings().revision,1);assert.equal(s.study.settings().onboarding,'DONE');assert.equal(s.overview().goals.length,0);assert.throws(()=>s.study.propose({conversation_id:c,content:'x',reason:'x',revision:0,request_id:id()}),/已更新/);
});
test('semantic review batches edits, records temporary reason and only proposes long-term profile',t=>{
 const s=setup(t),n=s.saveNote({title:'笔记',content:'原内容'});let before=s.study.auditSnapshot();s.saveNote({id:n.id,title:'笔记',content:'新的内容'});s.study.audit(before);before=s.study.auditSnapshot();s.saveNote({id:n.id,title:'笔记',content:'完全不同的理解'});s.study.audit(before);
 let b=s.db.prepare('SELECT * FROM change_batches').get();assert.equal(JSON.parse(b.changes).length,1);assert.equal(JSON.parse(b.changes)[0].before.content,'原内容');s.db.prepare('UPDATE change_batches SET updated_at=?').run('2000-01-01');s.study.tick();b=s.db.prepare('SELECT * FROM change_batches').get();const c=b.conversation_id;
 s.study.review({conversation_id:c,significant:true,question:'这次调整是临时安排，还是长期偏好变化？',reason:'学习方向发生改变',request_id:id()});complete(s,c);assert.equal(s.study.state().changes[0].status,'WAITING_REASON');assert.throws(()=>s.study.propose({conversation_id:c,revision:0,content:'画像',reason:'猜测',request_id:id()}),/用户解释/);
 s.send(c,'这周忙，但以后也更喜欢项目实践',id());s.study.reason({conversation_id:c,reason:'本周临时忙；长期更偏好项目实践',request_id:id()});const p=s.study.propose({conversation_id:c,revision:0,content:'偏好项目实践',reason:'用户明确解释',request_id:id()});assert.equal(s.study.settings().profile,'');assert.throws(()=>s.study.confirm({id:p.id,accept:true,request_id:id()}),/等待/);complete(s,c);s.study.confirm({id:p.id,accept:true,request_id:id()});assert.equal(s.study.settings().profile,'偏好项目实践');
});
test('insignificant edits cause no question; skip cancels outstanding jobs and suggestions',t=>{
 const s=setup(t);s.study.record([{type:'notes',id:'x',before:{content:'a'},after:{content:'b'}}]);s.db.prepare('UPDATE change_batches SET updated_at=?').run('2000-01-01');s.study.tick();const b=s.study.state().changes[0];s.study.review({conversation_id:b.conversation_id,significant:false,question:'',reason:'只是措辞调整',request_id:id()});assert.equal(s.study.state().changes[0].status,'NO_QUESTION');s.study.skip({id:b.id});assert.equal(s.overview().jobs[0].status,'CANCELLED');
});
test('reading context excludes future queued snapshots',t=>{
 const s=setup(t),r=s.study.open({url:'https://example.com'});s.study.ask({conversation_id:r.conversation_id,content:'第一问',page_content:'FIRST',request_id:id()});s.study.ask({conversation_id:r.conversation_id,content:'第二问',page_content:'FUTURE',request_id:id()});const ctx=s.context(r.conversation_id);ctx.messages=ctx.messages.slice(0,1);limitStudyContext(ctx);assert.equal(ctx.study.snapshots.length,1);assert.equal(ctx.study.snapshots[0].content,'FIRST');
});
test('API onboarding uses scoped tools, binds target and creates no goals',async t=>{
 const s=setup(t),c=s.study.onboarding({action:'start',request_id:id()}).conversation_id;let calls=0;
 const p=s.models.save({name:'mock',base_url:'https://example.com/v1',model:'test'});s.models.routes({routes:[{module:'chat',profile_id:p.id}]});s.models.enabled(true);
 const x=modelExecutor(s,{intervalMs:1000000,fetcher:async(_url,opts)=>{const req=JSON.parse(opts.body);assert.match(req.messages[0].content,/首次引导/);assert.deepEqual(req.tools.map(t=>t.function.name),['teacher_get_context','teacher_propose_profile']);calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:calls===1?{tool_calls:[{id:'p',type:'function',function:{name:'teacher_propose_profile',arguments:JSON.stringify({conversation_id:'forged',revision:0,content:'用户自述：有基础',reason:'自我介绍'})}}]}:{content:'请确认画像，或继续对话修正。'}}]}));}});t.after(()=>x.stop());await x.tick();assert.equal(s.models.state().runs[0].status,'COMPLETED');assert.equal(s.study.state().suggestions[0].conversation_id,c);assert.equal(s.overview().goals.length,0);
});
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {startServer} from '../server/index.mjs';
test('existing data skips onboarding; study upgrade creates a backup and persists reading on reopen',t=>{
 const dir=mkdtempSync(join(tmpdir(),'study-migration-')),file=join(dir,'teacher.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const db=new DatabaseSync(file);db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));db.prepare('INSERT INTO goals VALUES(?,?,?,?,?,?)').run('old','已有目标','学习','','INITIALIZING','now');db.close();
 let s=createStore(file);assert.equal(s.study.settings().onboarding,'EXISTING');const r=s.study.open({url:'https://example.com'});s.study.progress({resource_id:r.resource.id,title:'课文',location:'第 3 页'});s.db.close();s=createStore(file);assert.equal(s.study.state().progress[0].location,'第 3 页');assert.equal(s.overview().goals.length,1);assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(readdirSync(join(dir,'backups')).filter(n=>n.startsWith('before-study-')).length,1);s.db.close();
});
test('study HTTP requires user session; capability edits create new versions retaining previous definitions',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'study-http-')),app=startServer({port:0,dataDir:dir});await once(app.server,'listening');t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});const base='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(base+'/')).headers.get('set-cookie').split(';')[0];
 const post=(path,a,headers={Cookie:cookie})=>fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(a)});
 assert.equal((await post('study/open',{url:'https://example.com'},{})).status,401);assert.equal((await post('study/open',{url:'https://example.com'},{Cookie:cookie,Authorization:'Bearer '+app.token})).status,403);
 const r=await (await post('study/open',{url:'https://example.com'})).json();assert.equal((await post('study/ask',{conversation_id:r.conversation_id,content:'问题',page_content:'当前正文',request_id:id()})).status,200);
 const s=app.store,g=s.createGoal({title:'学习',domain:'基础'}).goal,p=s.learning.proposeCapabilities({goal_id:g.id,items:[{title:'基础能力',kind:'CORE',requirements:[{node:'知识点',description:'原有要求'}]}],request_id:id()});s.learning.confirmCapabilities({id:p.proposal_id,accept:true});const old=s.learning.state().requirements[0];
 const result=await post('study/edit',{type:'requirement',id:old.id,fields:{description:'更深入的新要求'}});assert.equal(result.status,200,await result.text());assert.equal(s.db.prepare('SELECT description FROM requirements WHERE id=?').get(old.id).description,'原有要求');assert.equal(s.learning.state().capability_sets.filter(x=>x.status==='ACCEPTED').length,1);assert.ok(s.learning.state().requirements.some(r=>r.description==='更深入的新要求'));assert.equal(s.study.state().changes[0].status,'COLLECTING');
});
