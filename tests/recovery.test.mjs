import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {createStore,id} from '../server/store.mjs';
import {startServer} from '../server/index.mjs';
import {recoveryRows,recoveryPreviewHtml,recoveryDate} from '../public/recovery.js';

const input=ids=>({entry_ids:ids,as_of:'2026-10-20',start_date:'2026-10-23',daily_minutes:60,weekdays:[1,2,3,4,5]});
const commit=(s,p)=>s.recovery.commit({...p.input,fingerprint:p.fingerprint,request_id:id()});
function memory(t){const s=createStore(':memory:');t.after(()=>s.db.close());return s;}
function route(s){
 const L=s.learning,g=s.createGoal({title:'缓存学习',domain:'计算机'}).goal.id;
 const cap=L.proposeCapabilities({goal_id:g,items:[{title:'缓存能力',kind:'CORE',requirements:[{node:'缓存',description:'解释并应用缓存'}]}],request_id:id()});L.confirmCapabilities({id:cap.proposal_id,accept:true});
 const req=L.state(g).requirements[0].id,a=L.begin({goal_id:g,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',request_id:id()});L.endEarly({id:a.assessment_id});
 const topic=(key,dependencies)=>({key,title:key,dependencies,requirement_ids:[req],resource_ids:[],sessions:[{title:key,objective:'解释'+key}]});
 const p=L.proposeRoadmap({goal_id:g,title:'路线',summary:'基础后应用',phases:[{title:'缓存',topics:[topic('应用',['基础']),topic('基础',[])]}],request_id:id()});L.decide({id:p.proposal_id,accept:true});
 const sessions=s.overview().sessions,base=sessions.find(x=>x.title==='基础'),next=sessions.find(x=>x.title==='应用');
 return {L,g,req,base,next};
}
function entry(s,title,session,date='2026-10-19',duration=30){return s.calendar.save({title,session_id:session?.id,date,duration,time:'19:00'}).id;}

test('recovery previews without writes, respects existing load and weekdays, preserves progress and persists the same records',t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-recovery-')),file=join(dir,'teacher.sqlite');let s=createStore(file);t.after(()=>{s.db.close();rmSync(dir,{recursive:true,force:true});});
 const a=entry(s,'读资料',null,'2026-10-18',20),b=entry(s,'整理笔记',null,'2026-10-19',20),fixed=entry(s,'原有周五安排',null,'2026-10-23',45);
 s.calendar.progress({id:a,progress:60,notes:'下次继续第二章'});const before=s.calendar.state(),p=s.recovery.preview(input([b,a]));assert.deepEqual(s.calendar.state(),before);
 assert.deepEqual(p.entries.map(e=>e.id),[a,b]);assert.deepEqual(p.entries.map(e=>e.date),['2026-10-26','2026-10-26']);assert.equal(p.days[0].minutes,40);
 const request={...p.input,fingerprint:p.fingerprint,request_id:id()},result=s.recovery.commit(request);assert.deepEqual(s.recovery.commit(request),result);assert.equal(s.calendar.state().length,3);assert.equal(s.overview().evidence.length,0);
 s.db.close();s=createStore(file);const saved=s.calendar.state().find(e=>e.id===a);assert.equal(saved.progress,60);assert.equal(saved.notes,'下次继续第二章');assert.equal(saved.time,'19:00');assert.equal(s.calendar.state().find(e=>e.id===fixed).date,'2026-10-23');
});

test('recovery orders selected prerequisites, rejects omitted overdue predecessors and protects fixed future successors',t=>{
 const s=memory(t),{base,next}=route(s),child=entry(s,'应用',next),parent=entry(s,'基础',base);
 assert.throws(()=>s.recovery.preview(input([child])),/同时选择/);
 const p=s.recovery.preview(input([child,parent]));assert.deepEqual(p.entries.map(e=>e.id),[parent,child]);assert.equal(p.entries[0].date,p.entries[1].date);assert.ok(p.entries[0].position<p.entries[1].position);
 s.calendar.save({id:child,title:'应用',session_id:next.id,date:'2026-10-23',duration:30});assert.throws(()=>s.recovery.preview(input([parent])),/已有后续安排/);
 s.calendar.save({id:child,title:'应用',session_id:next.id,date:'2026-10-27',duration:30});const safe=s.recovery.preview(input([parent]));assert.equal(safe.entries[0].date,'2026-10-23');commit(s,safe);assert.equal(s.calendar.state().find(e=>e.id===child).date,'2026-10-27');
});

test('recovery rejects an unscheduled prerequisite and places selected work after a fixed prerequisite',t=>{
 const s=memory(t),{base,next}=route(s),child=entry(s,'应用',next);
 assert.throws(()=>s.recovery.preview(input([child])),/先为前置任务/);
 entry(s,'基础',base,'2026-10-26');const p=s.recovery.preview(input([child]));assert.equal(p.entries[0].date,'2026-10-27');
});

test('changed progress invalidates a preview and failure in any date update rolls back the whole selection',t=>{
 const s=memory(t),a=entry(s,'A'),b=entry(s,'B'),p=s.recovery.preview(input([a,b]));s.calendar.progress({id:a,progress:20,notes:'新记录'});assert.throws(()=>commit(s,p),/已变化/);
 const fresh=s.recovery.preview(input([a,b])),before=s.calendar.state(),request={...fresh.input,fingerprint:fresh.fingerprint,request_id:id()};
 s.db.exec("CREATE TRIGGER refuse_recovery BEFORE UPDATE OF date ON calendar_entries WHEN NEW.title='B' BEGIN SELECT RAISE(ABORT,'isolated update failure'); END");assert.throws(()=>s.recovery.commit(request),/isolated update failure/);assert.deepEqual(s.calendar.state(),before);s.db.exec('DROP TRIGGER refuse_recovery');
 s.recovery.commit(request);assert.equal(s.calendar.state().filter(e=>e.date==='2026-10-23').length,2);
});

test('recovery lists blocked goals and versions without allowing their dates to be changed',t=>{
 const s=memory(t),{L,g,base}=route(s),a=entry(s,'基础',base);s.setGoalStatus(g,'PAUSED');assert.match(s.recovery.options({as_of:'2026-10-20'}).entries[0].blocked_reason,/恢复/);assert.throws(()=>s.recovery.preview(input([a])),/恢复/);s.setGoalStatus(g,'ACTIVE');
 s.db.prepare("UPDATE sessions SET status='ASSESSING' WHERE id=?").run(base.id);assert.throws(()=>s.recovery.preview(input([a])),/正在考察/);s.db.prepare("UPDATE sessions SET status='PLANNED' WHERE id=?").run(base.id);
 const p=L.proposeCapabilities({goal_id:g,items:[{title:'新版',kind:'CORE',requirements:[{node:'新版',description:'新版要求'}]}],request_id:id()});L.confirmCapabilities({id:p.proposal_id,accept:true});assert.throws(()=>s.recovery.preview(input([a])),/能力要求已更新/);
 for(const change of [{as_of:'bad'},{start_date:'2026-02-30'},{start_date:'2026-10-19'},{daily_minutes:0},{daily_minutes:1.5},{weekdays:[]},{weekdays:[7]},{entry_ids:[]},{entry_ids:[a,a]},{entry_ids:['missing']}])assert.throws(()=>s.recovery.preview({...input([a]),...change}));
 const independent=entry(s,'长任务',null,'2026-10-19',120);assert.throws(()=>s.recovery.preview(input([independent])),/超过每日预算/);s.calendar.done({id:independent,done:true});assert.throws(()=>s.recovery.preview(input([independent])),/已不属于/);
});

test('recovery moves a remediation calendar entry while keeping its original gap, resources, evidence and review dates',t=>{
 const s=memory(t),{L,g,req}=route(s),a=L.begin({goal_id:g,kind:'FREE_TEST',mode:'CLOSED_BOOK',requirement_ids:[req],request_id:id()}),job=s.claim('isolated',a.conversation_id).job;
 const q=L.question({assessment_id:a.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'解释缓存',requirement_ids:[req],request_id:id()});s.send(a.conversation_id,'还不能解释',id());L.feedback({round_id:q.round_id,feedback:'需要补学',request_id:id()});
 L.finish({assessment_id:a.assessment_id,summary:'需补学',profile:'继续学习',change_summary:'实际回答',relations:[{requirement_id:req,relation:'CONTRADICTS'}],gaps:[{requirement_id:req,description:'理解不足',reason:'不能解释'}],readiness:[],request_id:id()});
 const gap=L.state(g).gaps[0],task=s.remediation.schedule({gap_id:gap.id,date:'2026-10-19',duration:20,activity:'回看例题',resource_ids:[],request_id:id()});L.schedule({goal_id:g,requirement_id:req,due_date:'2026-10-18',reason:'原复习',request_id:id()});
 s.calendar.progress({id:task.id,progress:40,notes:'继续例题'});const before=s.overview();commit(s,s.recovery.preview(input([task.id])));const after=s.overview();assert.deepEqual(after.remediation,before.remediation);assert.deepEqual(after.learning.gaps,before.learning.gaps);assert.deepEqual(after.evidence,before.evidence);assert.deepEqual(after.learning.reviews,before.learning.reviews);assert.equal(after.calendar[0].progress,40);assert.equal(after.calendar[0].notes,'继续例题');
 s.calendar.save({id:task.id,title:'补学',date:'2026-10-19',duration:20});s.db.prepare("UPDATE gaps SET status='RESOLVED' WHERE id=?").run(gap.id);assert.throws(()=>s.recovery.preview(input([task.id])),/薄弱点已解决/);
});

test('recovery preview escapes stored text and HTTP actions require a user session',async t=>{
 assert.match(recoveryRows([{id:'a',title:'<script>x</script>',date:'2026-10-19',duration:20,progress:0,kind:'补学',notes:'<img>',blocked_reason:'暂停'}]),/&lt;script&gt;/);assert.match(recoveryRows([{id:'a',blocked_reason:'暂停'}]),/disabled/);assert.equal(recoveryDate(new Date(2026,11,31,12)),'2026-12-31');
 const dir=mkdtempSync(join(tmpdir(),'teacher-recovery-http-')),app=startServer({port:0,dataDir:dir});await once(app.server,'listening');t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0],a=entry(app.store,'<script>日程</script>');
 const post=(route,body,headers={Cookie:cookie})=>fetch(base+'/api/calendar/recovery-'+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 for(const route of ['options','preview','commit']){assert.equal((await post(route,{},{})).status,401);assert.equal((await post(route,{},{Cookie:cookie,Authorization:'Bearer '+app.token})).status,403);}
 assert.equal((await post('options',{as_of:'2026-10-20'})).status,200);const p=await (await post('preview',input([a]))).json();assert.doesNotMatch(recoveryPreviewHtml(p),/<script>/);assert.equal((await post('commit',{...p.input,fingerprint:p.fingerprint,request_id:id()})).status,200);
});
