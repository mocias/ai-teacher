import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore,id} from '../server/store.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
function setup(t){const s=createStore(':memory:');t.after(()=>s.db.close());const g=s.createGoal({title:'理解 KV Cache',domain:'AI Infra'}).goal.id;const l=s.learning;const p=l.proposeCapabilities({goal_id:g,request_id:id(),items:[{title:'独立解释缓存原理',kind:'CORE',requirements:[{node:'KV Cache',description:'解释为什么缓存 K/V 而非 Q'}]}]});l.confirmCapabilities({id:p.proposal_id,accept:true});const r=l.state(g).requirements[0].id;return {s,l,g,r};}
function runAssessment(s,l,g,r,kind='INITIAL_DIAGNOSTIC',extra={}){const a=l.begin({goal_id:g,kind,mode:'CLOSED_BOOK',scope:'KV 原理',requirement_ids:[r],resource_ids:[],request_id:id(),...extra});const job=s.claim('test',a.conversation_id).job;const q=l.question({assessment_id:a.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'为何不缓存 Q？',requirement_ids:[r],request_id:id()});s.send(a.conversation_id,'当前查询只需要当前 token 的 Q，历史 K/V 被重复使用。',id());l.feedback({round_id:q.round_id,feedback:'回答覆盖了复用关系。',request_id:id()});return a;}
function finish(l,g,r,a,extra={}){return l.finish({assessment_id:a.assessment_id,summary:'能够解释缓存复用关系',profile:'能独立解释 K/V 与 Q 的区别',change_summary:'获得解释能力证据',relations:[{requirement_id:r,relation:'SUPPORTS'}],readiness:[{readiness_id:l.state(g).readiness_items[0].id,judgment:'已展示独立解释能力',evidence_ids:[]}],gaps:[],completion_recommended:false,request_id:id(),...extra});}
function roadmap(l,g,r,resources=[]){return l.proposeRoadmap({goal_id:g,title:'缓存学习路线',summary:'基于诊断安排验证与应用',request_id:id(),phases:[{title:'机制',topics:[{key:'kv',title:'KV 原理',requirement_ids:[r],resource_ids:resources,dependencies:[],sessions:[{title:'缓存推导',objective:'从自注意力推导缓存复用'}]}]}]});}
test('end-to-end: capabilities → material analysis → diagnostic → structured plan → final → frozen goal',t=>{
 const {s,l,g,r}=setup(t);assert.throws(()=>roadmap(l,g,r),/诊断/);
 const resource=s.resource({goal_id:g,title:'说明',url:'https://example.com/kv',role:'PRIMARY'}).id;
 const material=l.material({resource_id:resource,scope:'第一节',content:'过去 token 的 K/V 会被后续查询复用。'});
 const diagnostic=runAssessment(s,l,g,r);assert.equal(l.rounds({id:diagnostic.assessment_id})[0].feedback,null);finish(l,g,r,diagnostic);assert.ok(l.rounds({id:diagnostic.assessment_id})[0].feedback);
 assert.throws(()=>roadmap(l,g,r,[resource]),/主材料/);l.analyzeMaterial({content_id:material.id,status:'ANALYZED',summary:'覆盖缓存复用的基本原理',request_id:id()});
 const p=roadmap(l,g,r,[resource]);assert.equal(s.overview().sessions.length,0);l.decide({id:p.proposal_id,accept:true});assert.equal(s.overview().goals[0].status,'ACTIVE');assert.equal(l.state(g).session_details[0].phase,'机制');
 const final=runAssessment(s,l,g,r,'FINAL');finish(l,g,r,final,{completion_recommended:true});l.endGoal({id:g,status:'COMPLETED'});assert.equal(s.overview().goals[0].status,'COMPLETED');assert.ok(l.state(g).goal_snapshots[0].content.final_interview_id);
 assert.throws(()=>s.resource({goal_id:g,title:'x',url:'https://example.com',role:'PRIMARY'}),/冻结/);assert.throws(()=>l.proposeCapabilities({goal_id:g}),/结束/);assert.throws(()=>s.setGoalStatus(g,'ACTIVE'));l.archive({id:g,archived:true});
 const review=l.schedule({goal_id:g,requirement_id:r,due_date:'2026-10-01',reason:'长期回忆验证',request_id:id()});assert.ok(l.startReview({id:review.id,request_id:id()}).assessment_id);
});
test('gaps and review: unsupported final rejected; review resolves with actual supporting evidence',t=>{
 const {s,l,g,r}=setup(t);const diag=runAssessment(s,l,g,r);finish(l,g,r,diag,{relations:[{requirement_id:r,relation:'CONTRADICTS'}],gaps:[{requirement_id:r,description:'混淆 Q 与 K/V',reason:'回答暴露混淆'}]});const p=roadmap(l,g,r);l.decide({id:p.proposal_id,accept:true});const f=runAssessment(s,l,g,r,'FINAL');assert.throws(()=>finish(l,g,r,f,{completion_recommended:true}),/核心缺口/);l.endEarly({id:f.assessment_id});assert.throws(()=>l.endGoal({id:g,status:'COMPLETED'}),/最终/);
 const gap=l.state(g).gaps[0];l.routeGap({id:gap.id,status:'ROUTED_TO_REVIEW'});const a=runAssessment(s,l,g,r,'REVIEW',{gap_id:gap.id});finish(l,g,r,a);assert.equal(l.state(g).gaps[0].status,'RESOLVED');
 l.endGoal({id:g,status:'ABANDONED',reason:'调整目标'});assert.throws(()=>l.schedule({goal_id:g,requirement_id:r,due_date:'2026-10-02',reason:'x',request_id:id()}),/终止/);
});
test('question state, leases, early ending and capability version confirmation',t=>{
 const {s,l,g,r}=setup(t);const a=l.begin({goal_id:g,kind:'FREE_TEST',mode:'OPEN_BOOK',request_id:id()});assert.throws(()=>s.send(a.conversation_id,'提前回答',id()),/等待回答/);assert.throws(()=>l.question({assessment_id:a.assessment_id,job_id:'bad',lease_token:'bad',question:'?',requirement_ids:[r],request_id:id()}),/失效/);
 const job=s.claim('test',a.conversation_id).job;assert.throws(()=>s.reply({job_id:job.id}),/结构化考察/);l.question({assessment_id:a.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'解释缓存',requirement_ids:[r],request_id:id()});l.endEarly({id:a.assessment_id});assert.throws(()=>s.send(a.conversation_id,'later',id()),/等待回答/);assert.equal(s.overview().evidence.length,0);
});
test('migration backs up V1 and preserves existing data on repeated opens',t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-migrate-'));const file=join(dir,'teacher.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));const db=new DatabaseSync(file);db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));db.prepare('INSERT INTO goals VALUES(?,?,?,?,?,?)').run('old','旧目标','旧领域','','INITIALIZING',new Date().toISOString());db.close();let s=createStore(file);assert.equal(s.overview().goals[0].id,'old');assert.equal(s.db.prepare('PRAGMA user_version').get().user_version,2);s.db.close();s=createStore(file);assert.equal(s.overview().goals.length,1);s.db.close();assert.equal(readdirSync(join(dir,'backups')).filter(x=>x.startsWith('before-v02')).length,1);
});

test('paused goals reject host questions and feedback; new capability versions require new diagnosis',t=>{
 const {s,l,g,r}=setup(t);const diag=runAssessment(s,l,g,r);finish(l,g,r,diag);l.decide({id:roadmap(l,g,r).proposal_id,accept:true});
 const a=l.begin({goal_id:g,kind:'FREE_TEST',mode:'CLOSED_BOOK',request_id:id()});const job=s.claim('test',a.conversation_id).job;s.setGoalStatus(g,'PAUSED');assert.throws(()=>l.question({assessment_id:a.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'解释缓存',requirement_ids:[r],request_id:id()}),/暂停/);s.setGoalStatus(g,'ACTIVE');l.endEarly({id:a.assessment_id});
 const p=l.proposeCapabilities({goal_id:g,request_id:id(),items:[{title:'新要求',kind:'CORE',requirements:[{node:'KV Cache',description:'解释增量计算'}]}]});l.confirmCapabilities({id:p.proposal_id,accept:true});const current=l.state(g).requirements.find(x=>x.set_id===p.proposal_id);assert.throws(()=>roadmap(l,g,current.id),/诊断/);assert.equal(l.state(g).capability_sets.filter(x=>x.status==='SUPERSEDED').length,1);
});

test('later evidence invalidates a final even when timestamps coincide',t=>{
 const {s,l,g,r}=setup(t);finish(l,g,r,runAssessment(s,l,g,r));l.decide({id:roadmap(l,g,r).proposal_id,accept:true});const final=runAssessment(s,l,g,r,'FINAL');finish(l,g,r,final,{completion_recommended:true});const later=runAssessment(s,l,g,r,'FREE_TEST');finish(l,g,r,later);s.db.prepare('UPDATE evidence SET created_at=? WHERE conversation_id=?').run('2000-01-01T00:00:00.000Z',later.conversation_id);assert.throws(()=>l.endGoal({id:g,status:'COMPLETED'}),/新证据/);
});
