import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore,id} from '../server/store.mjs';
function setup(t){const s=createStore(':memory:');t.after(()=>s.db.close());const {goal,conversation}=s.createGoal({title:'学习 KV Cache',domain:'AI Infra'});return {s,g:goal.id,c:conversation.id};}
test('message queue: independent chats, leases, cancellation and idempotent replies',t=>{
 const {s,g,c}=setup(t),request=id();const first=s.send(c,'从哪里开始？',request);assert.deepEqual(s.send(c,'从哪里开始？',request),first);
 s.send(c,'我的基础是 Python',id());const a=s.claim('Codex');assert.equal(a.job.message_id,first.message_id);assert.equal(s.claim('DSH').job,null);
 const other=s.newConversation(g,'另一讨论');s.send(other.id,'另一条',id());assert.ok(s.claim('DSH').job);
 const result={job_id:a.job.id,lease_token:a.job.lease_token,content:'你希望解决什么问题？',request_id:id()};const reply=s.reply(result);assert.deepEqual(s.reply(result),reply);assert.equal(s.messages(c).filter(x=>x.role==='assistant').length,1);
 const second=s.claim('Codex');s.cancel(second.job.id);assert.throws(()=>s.reply({...result,job_id:second.job.id,lease_token:second.job.lease_token,request_id:id()}),/失效/);
});
test('expired claims are recoverable and stale worker cannot publish',t=>{
 const {s,c}=setup(t);s.send(c,'hi',id());const old=s.claim('A');s.db.prepare('UPDATE jobs SET lease_until=0 WHERE id=?').run(old.job.id);const fresh=s.claim('B');assert.equal(fresh.job.id,old.job.id);assert.notEqual(fresh.job.lease_token,old.job.lease_token);assert.throws(()=>s.reply({job_id:old.job.id,lease_token:old.job.lease_token,content:'late',request_id:id()}),/失效/);assert.ok(s.renew(fresh.job.id,fresh.job.lease_token).lease_until>Date.now());
});
test('roadmap proposal requires confirmation; preserved history and pause rules',t=>{
 const {s,g}=setup(t);const proposal=s.propose({goal_id:g,title:'路线',summary:'基础到应用',items:[{title:'KV 缓存',objective:'解释保存的内容'}],request_id:id()});assert.equal(s.overview().goals[0].status,'READY_FOR_CONFIRMATION');assert.equal(s.overview().sessions.length,0);
 s.decide(proposal.proposal_id,true);const session=s.overview().sessions[0];assert.equal(s.overview().goals[0].status,'ACTIVE');assert.throws(()=>s.decide(proposal.proposal_id,true),/已处理/);s.setGoalStatus(g,'PAUSED');assert.throws(()=>s.startSession(session.id),/激活/);s.setGoalStatus(g,'ACTIVE');assert.ok(s.startSession(session.id).conversation_id);assert.throws(()=>s.setGoalStatus(g,'COMPLETED'));
});
test('archived notes excluded; assessment requires actual answers and commits atomically',t=>{
 const {s,g,c}=setup(t);const note=s.saveNote({goal_id:g,title:'我会了',content:'这是自我报告'});assert.equal(s.context(c).notes.length,1);s.archiveNote(note.id,true);assert.equal(s.context(c).notes.length,0);assert.equal(s.overview().notes.length,1);
 const p=s.propose({goal_id:g,title:'路线',summary:'验证',items:[{title:'KV',objective:'解释 KV'}],request_id:id()});s.decide(p.proposal_id,true);const assessment=s.startSession(s.overview().sessions[0].id,'OPEN_BOOK').conversation_id;
 const base={conversation_id:assessment,summary:'能解释基础',profile:'在材料辅助下能解释 KV',change_summary:'新增基础证据',request_id:id()};assert.throws(()=>s.assessment({...base,source_message_ids:[s.messages(assessment)[0].id]}),/实际用户回答/);
 const answer=s.send(assessment,'缓存过去 token 的 key 和 value',id());assert.throws(()=>s.assessment({...base,source_message_ids:[answer.message_id],profile:''}),/不能为空/);assert.equal(s.overview().evidence.length,0);
 const input={...base,source_message_ids:[answer.message_id]};const r=s.assessment(input);assert.deepEqual(s.assessment(input),r);assert.equal(s.overview().evidence[0].mode,'OPEN_BOOK');assert.equal(s.overview().goals[0].status,'ACTIVE');
});
