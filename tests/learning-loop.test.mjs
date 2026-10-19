import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createStore,id} from '../server/store.mjs';
import {startServer} from '../server/index.mjs';
import {goalJourney,dueReviews} from '../public/journey.js';

function setup(t){const s=createStore(':memory:');t.after(()=>s.db.close());return s;}
function route(s){
 const g=s.createGoal({title:'理解缓存',domain:'计算机'}).goal.id,L=s.learning;
 const p=L.proposeCapabilities({goal_id:g,items:[{title:'解释缓存',kind:'CORE',requirements:[{node:'缓存',description:'解释缓存与应用'}]}],request_id:id()});L.confirmCapabilities({id:p.proposal_id,accept:true});
 const requirement=L.state(g).requirements[0].id,diagnosis=L.begin({goal_id:g,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',request_id:id()});L.endEarly({id:diagnosis.assessment_id});
 const topic=(key,dependencies)=>({key,title:key,requirement_ids:[requirement],resource_ids:[],dependencies,sessions:[{title:key,objective:'解释 '+key}]});
 const proposal=L.proposeRoadmap({goal_id:g,title:'有依赖的路线',summary:'先基础后应用',phases:[{title:'学习',topics:[topic('应用',['基础']),topic('基础',[])]}],request_id:id()});L.decide({id:proposal.proposal_id,accept:true});
 return {g,requirement};
}
const input=g=>({goal_id:g,start_date:'2026-10-23',weekdays:[1,2,3,4,5],daily_minutes:60,session_minutes:30});

test('resource becomes a formal goal atomically, preserves original material and reading, and persists',t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-loop-')),file=join(dir,'teacher.sqlite');let s=createStore(file);t.after(()=>{s.db.close();rmSync(dir,{recursive:true,force:true});});
 const bytes=Buffer.from('# 缓存\n原始内容'),r=s.resource({file:{name:'缓存.md',base64:bytes.toString('base64')}}),reading=s.study.open({resource_id:r.id});s.study.progress({resource_id:r.id,location:'缓存'});s.study.annotate({resource_id:r.id,location:'缓存',kind:'note',quote:'',note:'自己的理解'});
 const before=s.overview(),a={resource_id:r.id,goal:{title:'学习缓存',domain:'计算机',scope:'原理与应用'},role:'PRIMARY',request_id:id()};
 assert.throws(()=>s.attachResource({...a,goal:{title:'',domain:'计算机'}}));assert.equal(s.overview().goals.length,0);
 const linked=s.attachResource(a);assert.deepEqual(s.attachResource(a),linked);assert.equal(s.overview().goals.length,1);assert.equal(s.overview().resources.length,1);
 assert.deepEqual(s.overview().learning.material_contents,before.learning.material_contents);assert.equal(s.study.open({resource_id:r.id}).conversation_id,reading.conversation_id);assert.equal(s.study.annotations(r.id)[0].note,'自己的理解');assert.equal(s.overview().evidence.length,0);
 assert.throws(()=>s.attachResource({...a,request_id:id()}),/已有正式目标/);
 s.db.close();s=createStore(file);assert.equal(s.overview().resources[0].goal_id,linked.goal_id);assert.equal(s.study.state().progress[0].location,'缓存');assert.deepEqual(Buffer.from(s.db.prepare('SELECT content FROM resource_files WHERE resource_id=?').get(r.id).content),bytes);
 const second=s.resource({title:'另一个资料'}),{g}=route(s);s.setGoalStatus(g,'PAUSED');assert.throws(()=>s.attachResource({resource_id:second.id,goal_id:g,role:'REFERENCE',request_id:id()}),/进行中/);assert.equal(s.overview().resources.find(r=>r.id===second.id).goal_id,null);
});

test('batch preview respects explicit dependencies, weekdays, and existing daily load; confirmation is atomic and idempotent',t=>{
 const s=setup(t),{g}=route(s),a=input(g);s.calendar.save({title:'其他安排',date:a.start_date,duration:30});
 const preview=s.calendar.preview(a);assert.equal(s.calendar.state().length,1);assert.deepEqual(preview.entries.map(e=>[e.title,e.date]),[['基础','2026-10-23'],['应用','2026-10-26']]);
 const request={...a,fingerprint:preview.fingerprint,request_id:id()},result=s.calendar.batch(request);assert.deepEqual(s.calendar.batch(request),result);assert.equal(s.calendar.state().length,3);assert.equal(s.overview().evidence.length,0);assert.ok(s.overview().sessions.every(s=>s.status==='PLANNED'));
 assert.equal(s.calendar.preview(a).entries.length,0);
 s.calendar.cancel({id:result.entries[0].id});const next=s.calendar.preview(a);assert.equal(next.entries.length,1);assert.equal(next.entries[0].title,'基础');
});

test('stale preview, changed parameters, invalid budget and obsolete capability routes cannot partially commit',t=>{
 const s=setup(t),{g}=route(s),a=input(g),p=s.calendar.preview(a);
 s.calendar.save({title:'新增安排',date:a.start_date,duration:30});const before=s.calendar.state();
 assert.throws(()=>s.calendar.batch({...a,fingerprint:p.fingerprint,request_id:id()}),/已变化/);assert.deepEqual(s.calendar.state(),before);
 const fresh=s.calendar.preview(a);assert.throws(()=>s.calendar.batch({...a,daily_minutes:90,fingerprint:fresh.fingerprint,request_id:id()}),/已变化/);assert.deepEqual(s.calendar.state(),before);
 for(const invalid of [{start_date:'2026-02-30'},{weekdays:[]},{weekdays:[7]},{session_minutes:61},{daily_minutes:0}])assert.throws(()=>s.calendar.preview({...a,...invalid}));
 const cap=s.learning.proposeCapabilities({goal_id:g,items:[{title:'新要求',kind:'CORE',requirements:[{node:'新知识',description:'解释新知识'}]}],request_id:id()});s.learning.confirmCapabilities({id:cap.proposal_id,accept:true});assert.throws(()=>s.calendar.preview(a),/新版路线/);assert.deepEqual(s.calendar.state(),before);
});

test('rescheduling a prerequisite cannot place it after an existing successor; failed batch rolls back all entries',t=>{
 const s=setup(t),{g}=route(s),a=input(g),sessions=s.overview().sessions;
 const application=sessions.find(x=>x.title==='应用');s.calendar.save({session_id:application.id,title:application.title,date:a.start_date});
 assert.throws(()=>s.calendar.preview(a),/后续任务/);assert.equal(s.calendar.state().length,1);
 s.calendar.cancel({id:s.calendar.state()[0].id});
 s.db.prepare('UPDATE sessions SET title=? WHERE id=?').run('应用'.repeat(110),application.id);
 const preview=s.calendar.preview(a),before=s.calendar.state();
 assert.throws(()=>s.calendar.batch({...a,fingerprint:preview.fingerprint,request_id:id()}),/日程标题/);
 assert.deepEqual(s.calendar.state(),before,'第二项保存失败必须回滚已插入的第一项');
});

test('journey follows the latest accepted roadmap while preserving completed work from an earlier route',t=>{
 const s=setup(t),{g,requirement}=route(s),old=s.overview().proposals[0].id;
 s.db.prepare("UPDATE sessions SET status='COMPLETED' WHERE proposal_id=?").run(old);
 const proposal=s.learning.proposeRoadmap({goal_id:g,title:'新版路线',summary:'新增实践',request_id:id(),phases:[{title:'实践',topics:[{key:'new',title:'新主题',requirement_ids:[requirement],resource_ids:[],dependencies:[],sessions:[{title:'新任务',objective:'进一步实践'}]}]}]});s.learning.decide({id:proposal.proposal_id,accept:true});
 const j=goalJourney(s.overview(),g,'2026-10-23');assert.equal(j.stage,'schedule');assert.equal(s.overview().sessions.filter(x=>x.status==='COMPLETED').length,2);
 const p=s.calendar.preview(input(g));assert.deepEqual(p.entries.map(e=>e.title),['新任务']);
});

test('journey follows current capability version, prioritizes assessment and due review, and never treats calendar completion as mastery',t=>{
 const s=setup(t),{g,requirement}=route(s),j=()=>goalJourney(s.overview(),g,'2026-10-23');assert.equal(j().stage,'schedule');
 const a=input(g),p=s.calendar.preview(a),batch=s.calendar.batch({...a,fingerprint:p.fingerprint,request_id:id()});assert.equal(j().stage,'daily');
 for(const e of batch.entries)s.calendar.progress({id:e.id,progress:100,notes:'已读完'});assert.equal(j().stage,'practice');assert.equal(s.overview().evidence.length,0);
 const review=s.learning.schedule({goal_id:g,requirement_id:requirement,due_date:'2026-10-23',reason:'回忆验证',request_id:id()});assert.equal(j().stage,'review');assert.equal(dueReviews(s.overview(),'2026-10-23').length,1);
 const assessment=s.learning.startReview({id:review.id,request_id:id()});assert.equal(j().stage,'assessment');s.learning.endEarly({id:assessment.assessment_id});
 const cap=s.learning.proposeCapabilities({goal_id:g,items:[{title:'新版要求',kind:'CORE',requirements:[{node:'新知识',description:'新要求'}]}],request_id:id()});assert.equal(j().stage,'confirm-cap');s.learning.confirmCapabilities({id:cap.proposal_id,accept:true});assert.equal(j().stage,'diagnostic');assert.equal(dueReviews(s.overview(),'2026-10-23').length,0);
});

test('new workflow endpoints require browser session and reject Agent credentials',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-loop-http-')),app=startServer({port:0,dataDir:dir});await once(app.server,'listening');t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0];
 const health=await (await fetch(base+'/api/health')).json();assert.equal(health.version,'0.7.0');assert.ok(health.features.includes('learning-loop'));assert.ok(health.features.includes('review-followups'));assert.ok(health.features.includes('remediation-plans'));
 const post=(route,body,headers={Cookie:cookie})=>fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 for(const endpoint of ['resources/goal','calendar/preview','calendar/batch']){assert.equal((await post(endpoint,{},{})).status,401);assert.equal((await post(endpoint,{},{Cookie:cookie,Authorization:'Bearer '+app.token})).status,403);}
 const r=app.store.resource({title:'测试材料'});const linked=await post('resources/goal',{resource_id:r.id,role:'PRIMARY',goal:{title:'测试目标',domain:'测试'},request_id:id()});assert.equal(linked.status,200);assert.ok((await linked.json()).goal_id);
 const {g}=route(app.store),preview=await post('calendar/preview',input(g));assert.equal(preview.status,200);const p=await preview.json();assert.equal((await post('calendar/batch',{...input(g),fingerprint:p.fingerprint,request_id:id()})).status,200);
});
