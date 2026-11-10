import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore,id} from '../server/store.mjs';
import {startServer} from '../server/index.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';

function weekStart(offset=0){
 const d=new Date(),mondayShift=(d.getDay()+6)%7;d.setDate(d.getDate()-mondayShift+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function route(s,{title='统计目标',domain='统计',count=3}={}){
 const g=s.createGoal({title,domain}).goal.id,L=s.learning,p=L.proposeCapabilities({goal_id:g,request_id:id(),items:[{title:'能力',kind:'CORE',requirements:[{node:'统计',description:'解释统计结论'}]}]});L.confirmCapabilities({id:p.proposal_id,accept:true});
 const requirement=L.state(g).requirements[0].id,diagnostic=L.begin({goal_id:g,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',request_id:id()});L.endEarly({id:diagnostic.assessment_id});
 const sessions=Array.from({length:count},(_,i)=>({title:`统计任务 ${i+1}`,objective:'解释一个统计概念'}));
 const proposal=L.proposeRoadmap({goal_id:g,title:'自然周路线',summary:'按优先级安排',request_id:id(),phases:[{title:'主题',topics:[{key:'topic',title:'统计',requirement_ids:[requirement],resource_ids:[],dependencies:[],sessions}]}]});L.decide({id:proposal.proposal_id,accept:true});
 return {goal:g,requirement,sessions:s.overview().sessions.filter(x=>x.goal_id===g)};
}
function makeGap(s,goal,requirement){
 const L=s.learning,a=L.begin({goal_id:goal,kind:'FREE_TEST',mode:'CLOSED_BOOK',requirement_ids:[requirement],request_id:id()}),job=s.claim('week-plan-test').job,q=L.question({assessment_id:a.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'解释统计结论',requirement_ids:[requirement],request_id:id()});
 s.send(a.conversation_id,'我的回答与本次要求不一致',id());L.feedback({round_id:q.round_id,feedback:'请核对定义',request_id:id()});L.finish({assessment_id:a.assessment_id,summary:'发现概念混淆',profile:'待加强',change_summary:'记录薄弱点',relations:[{requirement_id:requirement,relation:'CONTRADICTS'}],gaps:[{requirement_id:requirement,description:'统计概念混淆',reason:'回答未支持要求'}],readiness:[],request_id:id()});
 return L.state(goal).gaps[0];
}
function setup(t){const s=createStore(':memory:');t.after(()=>s.db.close());return s;}
const input=(start,revision=1)=>({start_date:start,daily_minutes:60,session_minutes:30,review_minutes:20,weekdays:[1,2,3,4,5],domain_priority:['统计'],tz_offset:new Date().getTimezoneOffset(),revision});

test('preview reserves capacity for reviews, remediation and manual dates; confirmation writes only missing route entries',t=>{
 // Use a full future week: the current week's remaining capacity varies by day.
 const s=setup(t),{goal,requirement,sessions}=route(s),start=weekStart(7),first=sessions[0],second=sessions[1],third=sessions[2];
 const manual=s.calendar.save({session_id:first.id,title:first.title,date:start,duration:30});s.calendar.progress({id:manual.id,progress:40,notes:'人工记录的学习进度'});
 s.calendar.save({title:'个人预约',date:start,duration:10});
 s.learning.schedule({goal_id:goal,requirement_id:requirement,due_date:start,reason:'到期复习',request_id:id()});
 const gap=makeGap(s,goal,requirement);s.remediation.schedule({gap_id:gap.id,date:start,duration:20,activity:'重做一题并解释定义',resource_ids:[],request_id:id()});
 const before=s.calendar.state(),plan=s.weekPlan.preview(input(start));assert.equal(plan.entries.length,2);assert.deepEqual(plan.entries.map(x=>x.session_id),[second.id,third.id]);assert.ok(plan.entries.every(x=>x.date!==start&&x.duration===30));
 assert.ok(plan.fixed.some(x=>x.kind==='到期复习'));assert.ok(plan.fixed.some(x=>x.kind==='补学'));assert.ok(plan.fixed.some(x=>x.kind==='其他日程'));assert.deepEqual(s.calendar.state(),before,'preview does not write or alter progress');
 const request={...input(start),fingerprint:plan.fingerprint,request_id:id()},result=s.weekPlan.commit(request);assert.equal(result.entries.length,2);assert.deepEqual(s.weekPlan.commit(request),result);assert.equal(s.calendar.state().length,before.length+2);
 const preserved=s.calendar.state().find(x=>x.id===manual.id);assert.equal(preserved.date,start);assert.equal(preserved.progress,40);assert.equal(preserved.notes,'人工记录的学习进度');
 assert.equal(s.remediation.state().length,1);assert.equal(s.learning.state(goal).reviews.length,1);assert.equal(s.weekPlan.settings().revision,2);
 assert.deepEqual(s.calendar.state().filter(x=>x.session_id).map(x=>x.session_id).sort(),[first.id,second.id,third.id].sort());
});

test('domain priority changes the proposed order; stale preview and concurrent settings are rejected without partial entries',t=>{
 const s=setup(t),a=route(s,{title:'编程目标',domain:'编程',count:1}),b=route(s,{title:'数学目标',domain:'数学',count:1}),start=weekStart();
 const cfg={...input(start),daily_minutes:60,session_minutes:30,domain_priority:['数学','编程']},preview=s.weekPlan.preview(cfg);assert.deepEqual(preview.entries.map(x=>x.domain),['数学','编程']);
 s.calendar.save({title:'并行新日程',date:start,duration:15});const before=s.calendar.state();assert.throws(()=>s.weekPlan.commit({...cfg,fingerprint:preview.fingerprint,request_id:id()}),/已变化/);assert.deepEqual(s.calendar.state(),before);
 const current=s.weekPlan.settings(),saved=s.weekPlan.saveSettings({...input(start,current.revision),daily_minutes:75,domain_priority:['编程','数学'],request_id:id()});assert.equal(saved.daily_minutes,75);assert.equal(saved.revision,current.revision+1);assert.throws(()=>s.weekPlan.saveSettings({...input(start,current.revision),request_id:id()}),/已被其他操作更新/);
 assert.throws(()=>s.weekPlan.preview({...cfg,revision:current.revision}),/已变化/);
});

test('historical weeks are read-only and an empty preview can still save capacity preferences',t=>{
 const s=setup(t),{goal,sessions}=route(s,{count:1}),current=weekStart(),past=weekStart(-7);s.calendar.save({session_id:sessions[0].id,title:sessions[0].title,date:current,duration:30});
 assert.throws(()=>s.weekPlan.preview(input(past)),/历史自然周只读/);
 const plan=s.weekPlan.preview({...input(current),daily_minutes:45,session_minutes:20});assert.equal(plan.entries.length,0);
 assert.equal(s.weekPlan.saveSettings({...input(current),daily_minutes:45,session_minutes:20,request_id:id()}).daily_minutes,45);
 assert.ok(s.overview().goals.some(x=>x.id===goal));
});

test('a user-confirmed new week plan can replace a cancelled slot while retaining its history',t=>{
 const s=setup(t),{sessions}=route(s,{count:1}),start=weekStart(),old=s.calendar.save({session_id:sessions[0].id,title:sessions[0].title,date:start,duration:30});
 s.calendar.cancel({id:old.id});const preview=s.weekPlan.preview(input(start));assert.equal(preview.entries.length,1);assert.match(preview.entries[0].reason,/此前取消/);
 const result=s.weekPlan.commit({...input(start),fingerprint:preview.fingerprint,request_id:id()}),rows=s.calendar.state().filter(x=>x.session_id===sessions[0].id);
 assert.equal(result.entries.length,1);assert.equal(rows.length,2);assert.equal(rows.find(x=>x.id===old.id).cancelled,1);assert.equal(rows.filter(x=>!x.cancelled).length,1);
});

test('week-plan HTTP routes enforce browser-only writes and serve the planning UI module',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-week-plan-http-')),app=startServer({port:0,dataDir:dir});await once(app.server,'listening');t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0];
 const get=await fetch(base+'/api/week-plan/settings',{headers:{Cookie:cookie}});assert.equal(get.status,200);const settings=await get.json();
 const post=(path,body,headers={Cookie:cookie})=>fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const body={...input(weekStart(),settings.revision),domain_priority:[],request_id:id()};assert.equal((await post('week-plan/settings',body,{})).status,401);assert.equal((await post('week-plan/settings',body,{Cookie:cookie,Authorization:'Bearer '+app.token})).status,403);assert.equal((await post('week-plan/settings',body)).status,200);
 const preview=await fetch(base+'/week-plan.js');assert.equal(preview.status,200);assert.match(await preview.text(),/weekPlanDialog/);
});
