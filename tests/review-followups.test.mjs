import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {createStore,id} from '../server/store.mjs';
import {startServer} from '../server/index.mjs';
import {assessmentOutcome,assessmentReport,afterDays,remediationContent} from '../public/followups.js';
import {goalJourney} from '../public/journey.js';
import {reviewView} from '../public/learning.js';

function fixture(s){
 const g=s.createGoal({title:'函数组合',domain:'编程'}).goal.id,L=s.learning;
 const p=L.proposeCapabilities({goal_id:g,request_id:id(),items:[{title:'函数能力',kind:'CORE',requirements:[{node:'组合',description:'解释组合顺序'},{node:'输入',description:'解释输入类型'}]}]});L.confirmCapabilities({id:p.proposal_id,accept:true});
 return {s,L,g,reqs:L.state(g).requirements.map(r=>r.id)};
}
function answer(f,a,ids,contradicts=false){
 const {s,L}=f,job=s.claim('isolated',a.conversation_id).job;
 const q=L.question({assessment_id:a.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'解释组合顺序',requirement_ids:ids,request_id:id()});
 s.send(a.conversation_id,contradicts?'先做外层，再做内层':'先计算内层，将返回值传入外层',id());
 L.feedback({round_id:q.round_id,feedback:contradicts?'顺序需要纠正':'解释包含实际计算顺序',request_id:id()});
 L.finish({assessment_id:a.assessment_id,summary:'<script>本次反馈</script>',profile:'隔离画像',change_summary:'实际回答',relations:ids.map(r=>({requirement_id:r,relation:contradicts?'CONTRADICTS':'SUPPORTS'})),gaps:contradicts?[{requirement_id:ids[0],description:'顺序混淆',reason:'本次回答先做外层'}]:[],readiness:[],request_id:id()});
 return a;
}
function assessment(f,{kind='INITIAL_DIAGNOSTIC',ids=[f.reqs[0]],contradicts=false,...extra}={}){
 const a=f.L.begin({goal_id:f.g,kind,mode:'CLOSED_BOOK',requirement_ids:ids,request_id:id(),...extra});return answer(f,a,ids,contradicts);
}
function route(f){const p=f.L.proposeRoadmap({goal_id:f.g,title:'学习路线',summary:'先学后验证',request_id:id(),phases:[{title:'函数',topics:[{key:'fn',title:'组合',requirement_ids:f.reqs,resource_ids:[],dependencies:[],sessions:[{title:'阅读例题',objective:'验证组合'}]}]}]});f.L.decide({id:p.proposal_id,accept:true});return f.s.overview().sessions.find(s=>s.proposal_id===p.proposal_id);}
const request=(a,r)=>({source_assessment_id:a.assessment_id,requirement_id:r,due_date:'2026-10-22',reason:'验证本次暴露的计算顺序',request_id:id()});
const memory=t=>{const s=createStore(':memory:');t.after(()=>s.db.close());return fixture(s);};

test('follow-up requires actual evidence coverage, preserves provenance, and reuses an existing pending review without rewriting it',t=>{
 const f=memory(t),{s,L,g,reqs}=f,a=assessment(f),data=request(a,reqs[0]);
 assert.throws(()=>s.followups.schedule({request_id:id()}),/请选择/);assert.throws(()=>s.followups.cancel({request_id:id()}),/请选择/);
 assert.throws(()=>s.followups.schedule({...data,requirement_id:reqs[1]}),/实际涉及/);
 const pending=L.begin({goal_id:g,kind:'FREE_TEST',mode:'CLOSED_BOOK',request_id:id()});assert.throws(()=>s.followups.schedule(request(pending,reqs[0])),/先完成/);L.endEarly({id:pending.assessment_id});
 const review=s.followups.schedule(data),before=s.overview();assert.deepEqual(s.followups.schedule(data),review);assert.equal(before.learning.review_sources[0].assessment_id,a.assessment_id);assert.equal(before.learning.review_sources[0].evidence_id,before.evidence[0].id);
 const other=assessment(f,{kind:'FREE_TEST'}),duplicate=s.followups.schedule({...request(other,reqs[0]),due_date:'2026-10-28'});
 assert.equal(duplicate.reused,true);assert.equal(duplicate.id,review.id);assert.equal(duplicate.due_date,data.due_date);assert.equal(L.state(g).reviews.length,1);assert.equal(L.state(g).review_sources[0].assessment_id,a.assessment_id);
 assert.throws(()=>s.followups.schedule({...request(other,reqs[0]),due_date:'2026-02-30'}),/日期/);
 const cancelled={id:review.id,request_id:id()};s.followups.cancel(cancelled);assert.deepEqual(s.followups.cancel(cancelled),{ok:true});assert.equal(L.state(g).review_sources.length,1);
 assert.notEqual(s.followups.schedule(request(other,reqs[0])).id,review.id);assert.equal(s.overview().evidence.length,2);
});

test('a gap routes into review, remains unresolved on cancellation, and resolves only after supporting answers',t=>{
 const f=memory(t),{s,L,g,reqs}=f,a=assessment(f,{contradicts:true}),session=route(f);
 assessment(f,{kind:'LEARN',session_id:session.id,ids:reqs});
 assert.equal(goalJourney(s.overview(),g).stage,'gap','完成路线考察仍需处理核心缺口');
 const r=s.followups.schedule(request(a,reqs[0]));assert.equal(L.state(g).gaps[0].status,'ROUTED_TO_REVIEW');assert.equal(L.state(g).reviews[0].gap_id,L.state(g).gaps[0].id);
 s.followups.cancel({id:r.id,request_id:id()});assert.equal(L.state(g).gaps[0].status,'DETECTED');assert.equal(s.overview().evidence.length,2);
 const next=s.followups.schedule(request(a,reqs[0])),running=L.startReview({id:next.id,request_id:id()});
 assert.throws(()=>s.followups.cancel({id:next.id,request_id:id()}),/进行中/);
 answer(f,running,[reqs[0]]);assert.equal(L.state(g).gaps[0].status,'RESOLVED');assert.equal(goalJourney(s.overview(),g).stage,'final');assert.equal(s.overview().evidence.length,3);
 assert.throws(()=>s.followups.cancel({id:next.id,request_id:id()}),/仅待复习/);
});

test('obsolete assessments and paused goals cannot drive new follow-ups; incompatible pending review must be handled first',t=>{
 const f=memory(t),{s,L,g,reqs}=f,a=assessment(f);route(f);
 const old=L.schedule({goal_id:g,requirement_id:reqs[0],due_date:'2026-10-20',reason:'原安排',request_id:id()});
 const weaker=assessment(f,{kind:'FREE_TEST',contradicts:true});assert.throws(()=>s.followups.schedule(request(weaker,reqs[0])),/先处理或取消/);assert.equal(L.state(g).reviews.length,1);
 s.followups.cancel({id:old.id,request_id:id()});s.setGoalStatus(g,'PAUSED');assert.throws(()=>s.followups.schedule(request(a,reqs[0])),/暂停/);s.setGoalStatus(g,'ACTIVE');
 const p=L.proposeCapabilities({goal_id:g,request_id:id(),items:[{title:'新版',kind:'CORE',requirements:[{node:'新要求',description:'新版能力'}]}]});L.confirmCapabilities({id:p.proposal_id,accept:true});assert.throws(()=>s.followups.schedule(request(a,reqs[0])),/已更新/);assert.equal(assessmentOutcome(s.overview(),a.assessment_id).canSchedule,false);
});

test('follow-up migration preserves existing reviews, creates one backup, and persists linked provenance on reopen',t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-followups-')),file=join(dir,'teacher.sqlite');let s=createStore(file);t.after(()=>{s.db.close();rmSync(dir,{recursive:true,force:true});});const f=fixture(s),a=assessment(f);
 f.L.schedule({goal_id:f.g,requirement_id:f.reqs[1],due_date:'2026-10-21',reason:'旧版安排',request_id:id()});s.db.exec('DROP TABLE review_sources');s.db.close();
 s=createStore(file);assert.equal(s.learning.state(f.g).reviews.length,1);const r=s.followups.schedule(request(a,f.reqs[0]));s.db.close();s=createStore(file);
 assert.equal(s.learning.state(f.g).review_sources[0].review_id,r.id);assert.equal(s.learning.state(f.g).reviews.length,2);assert.equal(readdirSync(join(dir,'backups')).filter(n=>n.startsWith('before-review-followups')).length,1);
});

test('outcome UI hides unfinished conclusions, escapes results and exposes only current follow-up actions',t=>{
 const f=memory(t),{s,L,g,reqs}=f,a=assessment(f,{contradicts:true}),out=assessmentReport(s.overview(),a.assessment_id);
 assert.match(out,/&lt;script&gt;/);assert.doesNotMatch(out,/<script>/);assert.match(out,/followup-schedule/);assert.match(out,/followup-gap/);assert.match(out,/发现相反表现/);
 const pending=L.begin({goal_id:g,kind:'FREE_TEST',mode:'CLOSED_BOOK',request_id:id()});assert.equal(assessmentReport(s.overview(),pending.assessment_id),'');L.endEarly({id:pending.assessment_id});assert.doesNotMatch(assessmentReport(s.overview(),pending.assessment_id),/followup-schedule/);
 const r=s.followups.schedule(request(a,reqs[0]));assert.match(assessmentReport(s.overview(),a.assessment_id),/查看已有复习/);assert.doesNotMatch(assessmentReport(s.overview(),a.assessment_id),/followup-schedule/);assert.match(reviewView(s.overview(),g),/查看安排依据|未来安排/);
 assert.match(remediationContent(s.overview(),L.state(g).gaps[0].id),/新的回答证据/);assert.equal(afterDays(3,new Date(2026,11,30,12)),'2027-01-02');
 s.followups.cancel({id:r.id,request_id:id()});assert.match(reviewView(s.overview(),g),/已取消/);
});

test('follow-up HTTP actions require user session, reject Agent credentials, and roll back when provenance cannot be saved',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-followup-http-')),app=startServer({port:0,dataDir:dir});await once(app.server,'listening');t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0],f=fixture(app.store),a=assessment(f),data=request(a,f.reqs[0]);
 const post=(path,body,headers={Cookie:cookie})=>fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 for(const path of ['reviews/followup','reviews/cancel']){assert.equal((await post(path,{},{})).status,401);assert.equal((await post(path,{},{Cookie:cookie,Authorization:'Bearer '+app.token})).status,403);}
 app.store.db.exec("CREATE TRIGGER refuse_source BEFORE INSERT ON review_sources BEGIN SELECT RAISE(ABORT,'isolated write failure'); END");assert.throws(()=>app.store.followups.schedule(data),/isolated write failure/);assert.equal(f.L.state(f.g).reviews.length,0);app.store.db.exec('DROP TRIGGER refuse_source');
 const created=await post('reviews/followup',data);assert.equal(created.status,200);const r=await created.json();assert.equal((await post('reviews/cancel',{id:r.id,request_id:id()})).status,200);assert.equal(f.L.state(f.g).reviews[0].status,'CANCELLED');
});
