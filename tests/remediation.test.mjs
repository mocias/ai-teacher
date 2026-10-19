import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createStore,id} from '../server/store.mjs';
import {startServer} from '../server/index.mjs';
import {gapPlanActions,pendingRemediation,remediationHistory} from '../public/remediation.js';
import {goalJourney} from '../public/journey.js';

function fixture(s){
 const g=s.createGoal({title:'组合补学',domain:'编程'}).goal.id,L=s.learning;
 const p=L.proposeCapabilities({goal_id:g,items:[{title:'核心能力',kind:'CORE',requirements:[{node:'组合',description:'解释计算顺序'}]}],request_id:id()});L.confirmCapabilities({id:p.proposal_id,accept:true});
 const req=L.state(g).requirements[0].id,a=L.begin({goal_id:g,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',requirement_ids:[req],request_id:id()});
 const job=s.claim('isolated',a.conversation_id).job,q=L.question({assessment_id:a.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'解释组合顺序',requirement_ids:[req],request_id:id()});
 s.send(a.conversation_id,'先做外层再做内层',id());L.feedback({round_id:q.round_id,feedback:'顺序颠倒',request_id:id()});
 L.finish({assessment_id:a.assessment_id,summary:'需要补学',profile:'顺序仍需验证',change_summary:'实际回答',relations:[{requirement_id:req,relation:'CONTRADICTS'}],gaps:[{requirement_id:req,description:'<script>顺序混淆</script>',reason:'实际回答先做外层'}],readiness:[],request_id:id()});
 const road=L.proposeRoadmap({goal_id:g,title:'学习路线',summary:'学习后验证',phases:[{title:'组合',topics:[{key:'fn',title:'顺序',requirement_ids:[req],resource_ids:[],dependencies:[],sessions:[{title:'例题',objective:'计算例题'}]}]}],request_id:id()});L.decide({id:road.proposal_id,accept:true});
 const gap=L.state(g).gaps[0],resource=s.resource({goal_id:g,title:'组合资料',url:'',role:'PRIMARY'});
 return {s,L,g,gap,resource,request:()=>({gap_id:gap.id,date:'2026-10-25',duration:20,activity:'回看例题，再独立计算',resource_ids:[resource.id],request_id:id()})};
}
function memory(t){const s=createStore(':memory:');t.after(()=>s.db.close());return fixture(s);}

test('remediation saves the actual gap provenance atomically and reuses pending work without overwriting progress',t=>{
 const f=memory(t),a=f.request(),r=f.s.remediation.schedule(a);assert.deepEqual(f.s.remediation.schedule(a),r);
 f.s.calendar.progress({id:r.id,progress:40,notes:'下次从第二个例子继续'});
 const reused=f.s.remediation.schedule({...f.request(),date:'2026-10-28',activity:'不同输入'});assert.equal(reused.id,r.id);assert.equal(reused.date,a.date);assert.equal(reused.reused,true);
 const s=f.s.overview(),task=s.remediation[0];assert.equal(task.evidence_id,f.gap.evidence_id);assert.equal(task.activity,a.activity);assert.deepEqual(task.resource_ids,[f.resource.id]);assert.equal(s.calendar[0].progress,40);assert.equal(s.evidence.length,1);assert.equal(s.learning.gaps[0].status,f.gap.status);
 f.s.db.exec("CREATE TRIGGER refuse_remediation BEFORE INSERT ON remediation_tasks BEGIN SELECT RAISE(ABORT,'isolated failure'); END");f.s.calendar.cancel({id:r.id});
 assert.throws(()=>f.s.remediation.schedule(f.request()),/isolated failure/);assert.equal(f.s.calendar.state().length,1);assert.equal(f.s.remediation.state().length,1);
});

test('progress, cancellation and duplicate recovery preserve evidence and prevent rebinding a remedial task to a route',t=>{
 const f=memory(t),r=f.s.remediation.schedule(f.request()),session=f.s.overview().sessions[0];
 assert.throws(()=>f.s.calendar.save({id:r.id,title:'changed',date:'2026-10-25',session_id:session.id}),/不能改为路线/);
 f.s.calendar.progress({id:r.id,progress:100,notes:'补学完成，等待验证'});assert.equal(f.L.state(f.g).gaps[0].status,f.gap.status);assert.equal(f.s.overview().evidence.length,1);
 const second=f.s.remediation.schedule(f.request());assert.notEqual(second.id,r.id);assert.throws(()=>f.s.calendar.progress({id:r.id,progress:20,notes:'重新开始'}),/已有待完成补学/);
 f.s.calendar.cancel({id:second.id});assert.equal(f.s.remediation.state().length,2);assert.equal(f.L.state(f.g).gaps[0].status,f.gap.status);
 f.s.calendar.progress({id:r.id,progress:20,notes:'重新开始'});assert.equal(pendingRemediation(f.s.overview(),f.gap.id).entry_id,r.id);
});

test('new remediation rejects missing input, foreign resources, inactive goals, resolved gaps and outdated requirements',t=>{
 const f=memory(t),bad=[{}, {...f.request(),date:'2026-02-30'},{...f.request(),duration:0},{...f.request(),activity:' '},{...f.request(),resource_ids:['foreign']}];
 for(const a of bad)assert.throws(()=>f.s.remediation.schedule({...a,request_id:id()}));
 f.s.setGoalStatus(f.g,'PAUSED');assert.throws(()=>f.s.remediation.schedule(f.request()),/学习中/);f.s.setGoalStatus(f.g,'ACTIVE');
 f.s.db.prepare("UPDATE gaps SET status='RESOLVED' WHERE id=?").run(f.gap.id);assert.throws(()=>f.s.remediation.schedule(f.request()),/已经解决/);f.s.db.prepare("UPDATE gaps SET status='DETECTED' WHERE id=?").run(f.gap.id);
 const r=f.s.remediation.schedule(f.request()),p=f.L.proposeCapabilities({goal_id:f.g,items:[{title:'新版',kind:'CORE',requirements:[{node:'新版',description:'新要求'}]}],request_id:id()});f.L.confirmCapabilities({id:p.proposal_id,accept:true});
 assert.throws(()=>f.s.remediation.schedule(f.request()),/已更新/);assert.equal(pendingRemediation(f.s.overview(),f.gap.id),undefined);assert.equal(f.s.remediation.state()[0].entry_id,r.id);
});

test('V0.6 migration creates one backup and keeps plans, notes and original gap snapshots after reopen',t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-remediation-')),file=join(dir,'teacher.sqlite');let s=createStore(file);t.after(()=>{s.db.close();rmSync(dir,{recursive:true,force:true});});const f=fixture(s);
 s.db.exec('DROP TABLE remediation_tasks');s.db.close();s=createStore(file);const r=s.remediation.schedule(f.request());s.calendar.progress({id:r.id,progress:40,notes:'保留学习位置'});s.db.prepare('UPDATE gaps SET reason=? WHERE id=?').run('后来的新反馈',f.gap.id);s.db.close();s=createStore(file);
 assert.equal(s.calendar.state()[0].notes,'保留学习位置');assert.equal(s.remediation.state()[0].reason,f.gap.reason);assert.equal(s.learning.state(f.g).gaps[0].reason,'后来的新反馈');assert.equal(readdirSync(join(dir,'backups')).filter(n=>n.startsWith('before-remediation-')).length,1);
});

test('remediation UI exposes preserved records and the journey continues a scheduled core gap without claiming mastery',t=>{
 const f=memory(t),r=f.s.remediation.schedule(f.request()),s=f.s.overview();
 // Isolate the journey decision after the earlier route and material steps have been exercised elsewhere.
 s.resources=[];s.sessions.forEach(x=>x.status='COMPLETED');
 assert.equal(goalJourney(s,f.g).stage,'remediation');assert.equal(goalJourney(s,f.g).entry.id,r.id);
 const history=remediationHistory(s,f.g);assert.match(history,/&lt;script&gt;/);assert.doesNotMatch(history,/<script>/);
 const html=gapPlanActions(s,f.gap);assert.match(html,/继续已有补学/);assert.doesNotMatch(html,/remediation-schedule/);
 f.s.calendar.progress({id:r.id,progress:100,notes:''});const next=f.s.overview();next.resources=[];next.sessions.forEach(x=>x.status='COMPLETED');assert.equal(goalJourney(next,f.g).stage,'gap');assert.match(gapPlanActions(next,f.gap),/能力另行验证/);
});

test('remediation HTTP requires user confirmation and returns the plan in state without changing learning evidence',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-remediation-http-')),app=startServer({port:0,dataDir:dir});await once(app.server,'listening');t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0],f=fixture(app.store),body=f.request();
 const post=headers=>fetch(base+'/api/remediation/schedule',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await post({})).status,401);assert.equal((await post({Cookie:cookie,Authorization:'Bearer '+app.token})).status,403);assert.equal((await post({Cookie:cookie})).status,200);
 const s=await (await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();assert.equal(s.remediation.length,1);assert.equal(s.evidence.length,1);
});
