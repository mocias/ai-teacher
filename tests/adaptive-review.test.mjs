import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore,id} from '../server/store.mjs';
import {startServer} from '../server/index.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {weekStart,weeklyStudyView} from '../public/weekly-study.js';

function fixture(t){
 const s=createStore(':memory:');t.after(()=>s.db.close());const g=s.createGoal({title:'线性代数',domain:'数学'}).goal.id,L=s.learning;
 const p=L.proposeCapabilities({goal_id:g,request_id:id(),items:[{title:'矩阵',kind:'CORE',requirements:[{node:'矩阵',description:'解释矩阵乘法顺序'}]}]});L.confirmCapabilities({id:p.proposal_id,accept:true});
 const req=L.state(g).requirements[0].id;return {s,L,g,req};
}
function completed(f,{kind='FREE_TEST',relation='CONTRADICTS'}={}){
 const {L,g,req}=f,a=L.begin({goal_id:g,kind,mode:'CLOSED_BOOK',requirement_ids:[req],request_id:id()});return completeExisting(f,a,{relation});
}
function completeExisting(f,a,{relation='CONTRADICTS'}={}){
 const {s,L,req}=f,job=s.claim('test',a.conversation_id).job;
 const q=L.question({assessment_id:a.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'解释顺序',requirement_ids:[req],request_id:id()});s.send(a.conversation_id,'先计算内层',id());L.feedback({round_id:q.round_id,feedback:'回答反馈',request_id:id()});
 L.finish({assessment_id:a.assessment_id,summary:'已完成考察',profile:'能力画像',change_summary:'变化依据',relations:[{requirement_id:req,relation}],gaps:relation==='CONTRADICTS'?[{requirement_id:req,description:'顺序混淆',reason:'回答与顺序要求矛盾'}]:[],readiness:[],request_id:id()});return a;
}
test('settings are global and opt-in automation schedules a supported next review with idempotent provenance',t=>{
 const f=fixture(t),{s,g,req}=f;assert.equal(s.adaptive.settings().intensity,'STANDARD');assert.equal(s.adaptive.settings().auto_enabled,0);
 const key=id(),saved=s.adaptive.setIntensity({intensity:'INTENSIVE',auto_enabled:true,request_id:key});assert.equal(saved.auto_enabled,1);assert.deepEqual(s.adaptive.setIntensity({intensity:'INTENSIVE',auto_enabled:true,request_id:key}),saved);
 const first=completed(f);let reviews=s.learning.state(g).reviews;assert.equal(reviews.length,1);assert.equal(reviews[0].status,'DUE');assert.equal(reviews[0].reason.includes('回答与该要求相矛盾'),true);assert.equal(s.learning.state(g).review_sources[0].assessment_id,first.assessment_id);s.learning.reschedule({id:reviews[0].id,due_date:'2026-12-01'});assert.deepEqual(s.adaptive.afterAssessment(first.assessment_id),[]);assert.equal(s.learning.state(g).reviews[0].due_date,'2026-12-01');
 const started=s.learning.startReview({id:reviews[0].id,request_id:id()});completeExisting(f,started,{relation:'SUPPORTS'});reviews=s.learning.state(g).reviews;assert.equal(reviews.length,2);assert.equal(reviews[0].status,'DONE');assert.equal(reviews[1].status,'DUE');assert.match(reviews[1].reason,/支持该要求/);assert.equal(s.learning.state(g).review_sources.length,2);
});
test('accepting a suggestion twice with the same request id returns its original result',t=>{
 const f=fixture(t),a=completed(f),suggestion=f.s.adaptive.suggestions(f.g)[0],body={goal_id:f.g,source_assessment_id:a.assessment_id,requirement_id:f.req,due_date:suggestion.due_date,request_id:id()};
 const first=f.s.adaptive.accept(body);assert.deepEqual(f.s.adaptive.accept(body),first);assert.equal(f.L.state(f.g).reviews.length,1);
});
test('latest evidence wins and manual cancellation suppresses its old recommendation',t=>{
 const f=fixture(t),{s,g,req}=f,old=completed(f);const scheduled=s.followups.schedule({source_assessment_id:old.assessment_id,requirement_id:req,due_date:'2026-11-09',reason:'人工安排',request_id:id()});s.followups.cancel({id:scheduled.id,request_id:id()});assert.equal(s.adaptive.suggestions(g).some(x=>x.source_assessment_id===old.assessment_id),false);s.adaptive.setIntensity({intensity:'STANDARD',auto_enabled:true,request_id:id()});assert.deepEqual(s.adaptive.afterAssessment(old.assessment_id),[]);assert.equal(s.learning.state(g).reviews.length,1);
 completed(f,{relation:'SUPPORTS'});assert.equal(s.adaptive.suggestions(g).some(x=>x.source_assessment_id===old.assessment_id),false);
});
test('week view separates scheduled progress, answers, evidence and current gaps and can read history',t=>{
 const f=fixture(t),{s,g}=f,a=completed(f);s.db.prepare('UPDATE assessments SET ended_at=? WHERE id=?').run('2026-10-28T18:00:00.000Z',a.assessment_id);
 const g2=s.createGoal({title:'概率',domain:'统计'}).goal.id;s.db.prepare("UPDATE goals SET status='ACTIVE' WHERE id=?").run(g2);const cap=s.learning.proposeCapabilities({goal_id:g2,request_id:id(),items:[{title:'概率',kind:'CORE',requirements:[{node:'概率',description:'解释条件概率'}]}]});s.learning.confirmCapabilities({id:cap.proposal_id,accept:true});const req2=s.learning.state(g2).requirements[0].id,b=completed({...f,g:g2,req:req2},{relation:'SUPPORTS'});s.db.prepare('UPDATE assessments SET ended_at=? WHERE id=?').run('2026-10-30T18:00:00.000Z',b.assessment_id);
 const noEvidence=s.learning.begin({goal_id:g,kind:'FREE_TEST',mode:'CLOSED_BOOK',requirement_ids:[f.req],request_id:id()});s.db.prepare("UPDATE assessments SET status='COMPLETED',ended_at=? WHERE id=?").run('2026-10-31T18:00:00.000Z',noEvidence.assessment_id);
 const week=s.adaptive.week({start_date:'2026-10-26',tz_offset:-480});assert.deepEqual(week.week,{start:'2026-10-26',end:'2026-11-01',historical:true});assert.equal(week.summary.answers,2);assert.equal(week.summary.evidence,2);assert.equal(week.summary.gaps_current,1);assert.equal(week.domains.find(x=>x.domain==='数学').evidence,1);assert.equal(week.domains.find(x=>x.domain==='统计').assessments.length,1);assert.equal(week.assessment_results.length,2);assert.equal(week.assessment_domains[0].count,1);
 const view=weeklyStudyView(week);assert.match(view,/本周实际回答/);assert.match(view,/当前未解决/);assert.match(view,/本周作答与反馈/);assert.match(view,/概率/);assert.match(view,/已完成考察/);assert.match(view,/data-action="v2-results"/);assert.ok(view.indexOf('当前未解决的已记录缺口')<view.indexOf('本周作答与反馈'));assert.equal(weekStart('2026-10-26',-7),'2026-10-19');assert.throws(()=>s.adaptive.week({start_date:'2026-10-25'}),/周一/);
 const historical=s.adaptive.week({start_date:'2026-10-19',tz_offset:-480});assert.equal(historical.summary.evidence,0);assert.equal(historical.assessment_results.length,0);assert.equal(g,week.domains.find(x=>x.domain==='数学').goals[0].id);
});
test('weekly endpoints expose summaries and enforce user-only settings writes',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-adaptive-http-')),app=startServer({port:0,dataDir:dir});await once(app.server,'listening');t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0];
 const weekly=await fetch(base+'/api/weekly-study?start_date=2026-10-26&tz_offset=-480',{headers:{Cookie:cookie}});assert.equal(weekly.status,200);assert.equal((await weekly.json()).week.start,'2026-10-26');
 const script=await fetch(base+'/weekly-study.js');assert.equal(script.status,200);assert.match(await script.text(),/weeklyStudyView/);
 const body={intensity:'LIGHT',auto_enabled:false,request_id:id()},post=options=>fetch(base+'/api/adaptive-review/settings',{method:'POST',headers:{'Content-Type':'application/json',...options},body:JSON.stringify(body)});
 assert.equal((await post({Cookie:cookie})).status,200);assert.equal((await post({Cookie:cookie,Authorization:'Bearer '+app.token})).status,403);assert.equal(app.store.adaptive.settings().intensity,'LIGHT');
});

test('automatic follow-up and assessment evidence commit together and recover on retry', t => {
 const f=fixture(t), {s,L,g,req}=f;
 s.adaptive.setIntensity({intensity:'STANDARD',auto_enabled:true,request_id:id()});
 const a=L.begin({goal_id:g,kind:'FREE_TEST',mode:'CLOSED_BOOK',requirement_ids:[req],request_id:id()});
 const job=s.claim('local test',a.conversation_id).job;
 const q=L.question({assessment_id:a.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'解释计算顺序',requirement_ids:[req],request_id:id()});
 s.send(a.conversation_id,'先计算内层',id());
 L.feedback({round_id:q.round_id,feedback:'需要再验证',request_id:id()});
 const result={assessment_id:a.assessment_id,summary:'还需要练习',profile:'本次回答与要求矛盾',change_summary:'有新作答',relations:[{requirement_id:req,relation:'CONTRADICTS'}],gaps:[],readiness:[],request_id:id()};
 s.db.exec("CREATE TEMP TRIGGER fail_review_source BEFORE INSERT ON review_sources BEGIN SELECT RAISE(ABORT,'test rollback'); END");
 assert.throws(()=>L.finish(result),/test rollback/);
 assert.equal(s.overview().evidence.length,0);
 assert.equal(L.state(g).assessments[0].status,'WAITING_HOST');
 assert.equal(L.state(g).reviews.length,0);
 s.db.exec('DROP TRIGGER fail_review_source');
 const saved=L.finish(result); assert.deepEqual(L.finish(result),saved);
 assert.equal(s.overview().evidence.length,1);
 assert.equal(L.state(g).review_sources.length,1);
});
