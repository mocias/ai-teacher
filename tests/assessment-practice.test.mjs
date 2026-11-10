import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore,id} from '../server/store.mjs';
import {detailContent} from '../public/details.js';
import {learningView} from '../public/learning.js';
import {startServer} from '../server/index.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';

function setup(t){
 const s=createStore(':memory:');t.after(()=>s.db.close());
 const goal=s.createGoal({title:'概率模型',domain:'数学'}).goal.id,L=s.learning;
 const p=L.proposeCapabilities({goal_id:goal,request_id:id(),items:[{title:'推断',kind:'CORE',requirements:[{node:'贝叶斯',description:'解释先验与后验的关系'}]}]});L.confirmCapabilities({id:p.proposal_id,accept:true});
 s.db.prepare("UPDATE goals SET status='ACTIVE' WHERE id=?").run(goal);
 const req=L.state(goal).requirements[0].id,readiness=L.state(goal).readiness_items[0].id;
 return {s,L,goal,req,readiness};
}
function ask(f,assessmentId,{phase,question='解释你的思路',job:leased}={}){
 const job=leased||f.s.claim('practice-test').job;
 const q=f.L.question({assessment_id:assessmentId,job_id:job.id,lease_token:job.lease_token,question,requirement_ids:[f.req],...(phase?{phase}:{}),request_id:id()});
 const answer=f.s.send(job.conversation_id,'先说明我如何理解，再给出例子',id());
 f.L.feedback({round_id:q.round_id,feedback:'反馈基于这次实际回答',request_id:id()});
 return {round:q.round_id,answer:answer.message_id};
}
function finish(f,assessmentId,{relation='SUPPORTS',completion=false}={}){
 return f.L.finish({assessment_id:assessmentId,summary:'根据实际回答形成的考察结果',profile:'有来源的能力判断',change_summary:'记录本轮变化',relations:[{requirement_id:f.req,relation}],gaps:[],readiness:completion?[{readiness_id:f.readiness,judgment:'回答支持核心要求',evidence_ids:[]}]:[],completion_recommended:completion,request_id:id()});
}

test('Quick Check requires self-reported scope, two broad probes then focused questions, and preserves its linked Learn Session',t=>{
 const f=setup(t),{s,L,goal,req}=f,proposal=id(),session=id(),formal=s.newConversation(goal,'正式学习对话');
 assert.match(learningView(s.overview(),goal),/阶段自测/);assert.match(learningView(s.overview(),goal),/不改变挂接/);
 s.db.prepare('INSERT INTO proposals VALUES(?,?,?,?,?,?,?)').run(proposal,goal,'路线','测试','[]','ACCEPTED',new Date().toISOString());
 s.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?)').run(session,goal,proposal,'贝叶斯学习','练习后验','ASSESSING',0,formal.id);
 assert.throws(()=>L.begin({goal_id:goal,kind:'QUICK_CHECK',mode:'CLOSED_BOOK',session_id:session,scope:'',requirement_ids:[req],request_id:id()}),/已学范围/);
 const a=L.begin({goal_id:goal,kind:'QUICK_CHECK',mode:'CLOSED_BOOK',session_id:session,scope:'先验与后验的含义；我能解释公式，但不确定如何选先验',requirement_ids:[req],request_id:id()});
 assert.equal(s.db.prepare('SELECT status FROM sessions WHERE id=?').get(session).status,'ASSESSING');assert.equal(s.db.prepare('SELECT conversation_id FROM sessions WHERE id=?').get(session).conversation_id,formal.id);
 assert.match(s.context(a.conversation_id).learning?.context||s.learning.context(a.conversation_id).practice.self_report,/先验与后验/);
 const firstJob=s.claim('practice-test').job;assert.throws(()=>L.question({assessment_id:a.assessment_id,job_id:firstJob.id,lease_token:firstJob.lease_token,question:'提前聚焦',requirement_ids:[req],phase:'FOCUSED',request_id:id()}),/两道宽泛探问/);
 ask(f,a.assessment_id,{job:firstJob});ask(f,a.assessment_id,{phase:'BROAD'});
 assert.throws(()=>finish(f,a.assessment_id),/两道宽泛探问/);
 const focused=ask(f,a.assessment_id,{phase:'FOCUSED'});finish(f,a.assessment_id);
 const rounds=L.rounds({id:a.assessment_id});assert.deepEqual(rounds.map(r=>r.phase),['BROAD','BROAD','FOCUSED']);assert.ok(rounds.every(r=>r.feedback));assert.equal(s.overview().evidence.length,1);assert.equal(s.db.prepare('SELECT status FROM sessions WHERE id=?').get(session).status,'ASSESSING');assert.equal(s.db.prepare('SELECT conversation_id FROM sessions WHERE id=?').get(session).conversation_id,formal.id);
 assert.equal(JSON.parse(s.overview().evidence[0].source_message_ids).includes(focused.answer),true);
});

test('note verification invitations are explicit, versioned, deferrable, and only answers create evidence',t=>{
 const f=setup(t),{s,L,goal,req}=f,note=s.saveNote({goal_id:goal,title:'阶段小结',content:'我现在能独立解释后验概率的含义。'});
 const invite=s.practice.suggestNoteVerification({goal_id:goal,note_id:note.id,requirement_ids:[req],reason:'这条笔记记录了用户自述的能力变化，邀请其自愿重新验证。'});
 assert.equal(invite.status,'PENDING');assert.equal(s.practice.suggestNoteVerification({goal_id:goal,note_id:note.id,requirement_ids:[req],reason:'重复邀请'}).invite_id,invite.invite_id);
 const rendered=detailContent(s.overview(),'note',note.id);assert.match(rendered.body,/稍后提醒/);assert.match(rendered.body,/笔记只是你的自述/);
 assert.throws(()=>L.begin({goal_id:goal,kind:'NOTE_VERIFICATION',mode:'CLOSED_BOOK',scope:'',requirement_ids:[req],request_id:id()}),/先确认有效邀请/);
 const snoozed=s.practice.defer({invite_id:invite.invite_id,days:7});assert.ok(snoozed.deferred_until);assert.equal(s.practice.state(goal).note_verification_invites[0].status,'DEFERRED');
 s.db.prepare('UPDATE note_verification_invites SET deferred_until=? WHERE id=?').run('2000-01-01',invite.invite_id);assert.equal(s.practice.state(goal).note_verification_invites[0].status,'PENDING');
 const a=s.practice.start({invite_id:invite.invite_id,request_id:id()});assert.equal(s.practice.state(goal).note_verification_invites[0].status,'STARTED');assert.equal(s.overview().evidence.length,0);
 const r=ask(f,a.assessment_id);finish(f,a.assessment_id);assert.equal(s.overview().evidence.length,1);assert.deepEqual(JSON.parse(s.overview().evidence[0].source_message_ids),[r.answer]);
 assert.equal(s.practice.state(goal).note_verification_invites[0].status,'COMPLETED');assert.equal(s.practice.suggestNoteVerification({goal_id:goal,note_id:note.id,requirement_ids:[req],reason:'repeat'}).status,'COMPLETED');
 s.saveNote({id:note.id,goal_id:goal,title:'阶段小结',content:'我现在能独立推导并检查后验概率。'});
 const revised=s.practice.suggestNoteVerification({goal_id:goal,note_id:note.id,requirement_ids:[req],reason:'用户更新了能力变化说明，可重新邀请验证。'});assert.notEqual(revised.invite_id,invite.invite_id);
});

test('latest FINAL result controls completion; an early-ended newer interview invalidates an older pass',t=>{
 const f=setup(t),{s,L,goal,req}=f;
 function final(relation,pass){const a=L.begin({goal_id:goal,kind:'FINAL',mode:'CLOSED_BOOK',scope:'全部核心要求',requirement_ids:[req],request_id:id()});ask(f,a.assessment_id);finish(f,a.assessment_id,{relation,completion:pass});return a;}
 const failed=final('CONTRADICTS',false);assert.throws(()=>L.endGoal({id:goal,status:'COMPLETED'}),/通过|最新/);assert.equal(s.overview().goals.find(g=>g.id===goal).status,'ACTIVE');
 const passed=final('SUPPORTS',true);assert.deepEqual(L.endGoal({id:goal,status:'COMPLETED',reason:'已完成'}),{ok:true});assert.equal(s.overview().learning.goal_snapshots[0].content.final_interview_id,passed.assessment_id);
 assert.throws(()=>L.begin({goal_id:goal,kind:'FINAL',mode:'CLOSED_BOOK',request_id:id()}),/结束目标|仅允许长期复习/);assert.equal(s.overview().goals.find(g=>g.id===goal).status,'COMPLETED');
 assert.equal(s.overview().learning.assessments.find(a=>a.id===failed.assessment_id).status,'COMPLETED');
});

test('a newer FINAL ended early prevents reusing an earlier pass, and ending is transactionally rejected',t=>{
 const f=setup(t),{s,L,goal,req}=f;
 const prior=L.begin({goal_id:goal,kind:'FINAL',mode:'CLOSED_BOOK',scope:'全部核心要求',requirement_ids:[req],request_id:id()});ask(f,prior.assessment_id);finish(f,prior.assessment_id,{completion:true});
 const latest=L.begin({goal_id:goal,kind:'FINAL',mode:'CLOSED_BOOK',scope:'重新验证全部核心要求',requirement_ids:[req],request_id:id()});L.endEarly({id:latest.assessment_id});
 assert.throws(()=>L.endGoal({id:goal,status:'COMPLETED'}),/尚未完成或已提前结束/);assert.equal(s.overview().goals.find(g=>g.id===goal).status,'ACTIVE');assert.equal(s.overview().learning.goal_snapshots.length,0);
});

test('note verification endpoints require user confirmation and expose no direct invite-to-assessment bypass',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-note-practice-')),app=startServer({port:0,dataDir:dir});await once(app.server,'listening');t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0];
 const goal=app.store.createGoal({title:'复习目标',domain:'数学'}).goal.id,L=app.store.learning,p=L.proposeCapabilities({goal_id:goal,request_id:id(),items:[{title:'能力',kind:'CORE',requirements:[{node:'推导',description:'推导公式'}]}]});L.confirmCapabilities({id:p.proposal_id,accept:true});app.store.db.prepare("UPDATE goals SET status='ACTIVE' WHERE id=?").run(goal);const req=L.state(goal).requirements[0].id,n=app.store.saveNote({goal_id:goal,title:'变化',content:'我现在能推导公式'}),suggest=app.store.practice.suggestNoteVerification({goal_id:goal,note_id:n.id,requirement_ids:[req],reason:'笔记记录了用户自述的变化，邀请其自愿验证'});
 const post=(path,body,headers={Cookie:cookie})=>fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await post('notes/verification/start',{invite_id:suggest.invite_id,request_id:id()},{})).status,401);
 assert.equal((await post('notes/verification/start',{invite_id:suggest.invite_id,request_id:id()},{Cookie:cookie,Authorization:'Bearer '+app.token})).status,403);
 assert.throws(()=>L.begin({goal_id:goal,kind:'NOTE_VERIFICATION',mode:'CLOSED_BOOK',scope:'绕过邀请',requirement_ids:[req],request_id:id()}),/先确认有效邀请/);
 const started=await post('notes/verification/start',{invite_id:suggest.invite_id,request_id:id()});assert.equal(started.status,200);assert.ok((await started.json()).assessment_id);assert.equal(app.store.practice.state(goal).note_verification_invites[0].status,'STARTED');assert.equal(app.store.overview().evidence.length,0);
});

test('normal goal chat can offer note verification via API and task-scoped MCP, without exposing it to unrelated roles', async () => {
 const {executionTools}=await import('../server/agent-policy.mjs');
 const {agentCatalog}=await import('../server/agent-mcp.mjs');
 const {codexArgs}=await import('../server/codex-host.mjs');
 const tool='teacher_suggest_note_verification';
 assert.deepEqual(executionTools({module:'chat'},{}),[]);
 assert.ok(executionTools({module:'chat'},{learning:{goal_chat_action:{intent:'NOTE_VERIFICATION'}}}).includes(tool));
 assert.ok(agentCatalog('chat').some(t=>t.name===tool));
 assert.ok(codexArgs({effort:'low'}).some(a=>a.includes(tool)));
 for(const role of ['master','reading','material'])assert.ok(!agentCatalog(role).some(t=>t.name===tool));
 assert.ok(!executionTools({module:'chat'},{discovery:{}}).includes(tool));
});

test('a pre-upgrade quick check can finish without rewriting or stranding its linked lesson',t=>{
 const f=setup(t),{s,L,goal,req}=f,proposal=id(),session=id();
 s.db.prepare('INSERT INTO proposals VALUES(?,?,?,?,?,?,?)').run(proposal,goal,'旧路线','说明','[]','ACCEPTED',new Date().toISOString());
 s.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?)').run(session,goal,proposal,'旧任务','说明','PLANNED',0,null);
 s.rollingPlan.defer({session_id:session,reason:'晚些再学'});
 const qc=L.begin({goal_id:goal,kind:'QUICK_CHECK',mode:'CLOSED_BOOK',scope:'仅回忆基础',requirement_ids:[req],session_id:session,request_id:id()});
 // V0.14 stored no phase rows and used the lesson conversation pointer for incidental checks.
 s.db.prepare('DELETE FROM quick_check_state WHERE assessment_id=?').run(qc.assessment_id);
 s.db.prepare("UPDATE sessions SET conversation_id=?,status='ASSESSING' WHERE id=?").run(qc.conversation_id,session);
 const job=s.claim('fixture',qc.conversation_id).job;
 const q=L.question({assessment_id:qc.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'解释先验',requirement_ids:[req],request_id:id()});
 s.send(qc.conversation_id,'观测之前的假设',id());L.feedback({round_id:q.round_id,feedback:'收到回答',request_id:id()});
 finish(f,qc.assessment_id);
 assert.equal(L.rounds({id:qc.assessment_id}).length,1);
 const lesson=s.overview().sessions.find(x=>x.id===session);
 assert.equal(lesson.status,'PLANNED');assert.equal(lesson.conversation_id,null);
});
