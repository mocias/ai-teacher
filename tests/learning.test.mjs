import {test} from 'node:test';
import {priorLearning, previouslyAssessedNodes} from '../server/prior-learning.mjs';
import {priorLearningView} from '../public/prior-learning.js';
import {learningView} from '../public/learning.js';
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
test('initial route acceptance rechecks exact primary versions and catches materials added after proposal',t=>{
 const {s,l,g,r}=setup(t),resource=s.resource({goal_id:g,title:'初始主材料',role:'PRIMARY',scope:'第1章'}).id;
 const first=l.material({goal_id:g,resource_id:resource,scope:'第1章',content:'第一版主材料正文',confirm_scope:true});
 finish(l,g,r,runAssessment(s,l,g,r));l.analyzeMaterial({goal_id:g,content_id:first.id,status:'ANALYZED',summary:'已分析第一版',request_id:id()});
 const proposal=roadmap(l,g,r,[resource]);
 const revised=l.material({goal_id:g,resource_id:resource,scope:'第1章',content:'第二版尚未分析的正文',confirm_scope:true});
 assert.notEqual(revised.id,first.id);assert.throws(()=>l.decide({id:proposal.proposal_id,accept:true}),/当前正文尚未完成分析/);
 assert.equal(s.db.prepare('SELECT status FROM proposals WHERE id=?').get(proposal.proposal_id).status,'PENDING');assert.equal(s.overview().sessions.length,0);
 l.analyzeMaterial({goal_id:g,content_id:revised.id,status:'ANALYZED',summary:'已分析第二版',request_id:id()});
 const next=roadmap(l,g,r,[resource]);
 const late=s.resource({goal_id:g,title:'提案后新增主材料',role:'PRIMARY',scope:'第2章'});
 assert.throws(()=>l.decide({id:next.proposal_id,accept:true}),/提案后新增主材料.*缺少本目标范围的正文/);
 assert.equal(s.db.prepare('SELECT status FROM proposals WHERE id=?').get(next.proposal_id).status,'PENDING');
});
test('roadmap and assessment material references honor the current goal association, not the legacy owner',t=>{
 const {s,l,g,r}=setup(t),shared=s.resource({goal_id:g,title:'共享主材',role:'PRIMARY',scope:'第1章'}).id;
 const body=l.material({goal_id:g,resource_id:shared,scope:'第1章',content:'共享资料正文',confirm_scope:true});
 const ownerOnly=s.resource({goal_id:g,title:'仅 A 关联',role:'REFERENCE'}).id;
 const other=relatedGoal(s,'共享资料目标');s.attachResource({resource_id:shared,goal_id:other.g,role:'PRIMARY',scope:'第1章',content_id:body.id,request_id:id()});
 l.analyzeMaterial({goal_id:other.g,content_id:body.id,status:'ANALYZED',summary:'按 B 的正文版本分析',request_id:id()});
 finish(l,other.g,other.r,runAssessment(s,l,other.g,other.r));
 const plan={goal_id:other.g,title:'B 路线',summary:'只引用 B 正式关联材料',request_id:id(),phases:[{title:'主题',topics:[{key:'shared',title:'阅读共享主材',requirement_ids:[other.r],resource_ids:[shared],dependencies:[],sessions:[{title:'阅读并解释',objective:'基于第1章解释要求'}]}]}]};
 const proposal=l.proposeRoadmap(plan);assert.throws(()=>l.proposeRoadmap({...plan,request_id:id(),phases:[{...plan.phases[0],topics:[{...plan.phases[0].topics[0],resource_ids:[ownerOnly]}]}]}),/材料不属于当前目标/);
 l.decide({id:proposal.proposal_id,accept:true});
 assert.ok(l.begin({goal_id:other.g,kind:'LEARN',mode:'CLOSED_BOOK',requirement_ids:[other.r],resource_ids:[shared],request_id:id()}).assessment_id);
 assert.throws(()=>l.begin({goal_id:other.g,kind:'LEARN',mode:'CLOSED_BOOK',requirement_ids:[other.r],resource_ids:[ownerOnly],request_id:id()}),/资料不属于当前目标/);
});

test('active-goal primary additions trigger only selected local diagnosis; both completed and early-ended diagnoses release that requirement',t=>{
 const {s,l,g,r}=setup(t),set=l.state(g).capability_sets.find(x=>x.status==='ACCEPTED');
 const item=id(),node=id(),otherReq=id();s.db.prepare('INSERT INTO readiness_items VALUES(?,?,?,?,?)').run(item,g,set.id,'另一项能力','CORE');s.db.prepare('INSERT INTO knowledge_nodes VALUES(?,?,?)').run(node,'KV Cache 应用','AI Infra');s.db.prepare('INSERT INTO requirements VALUES(?,?,?,?,?,?)').run(otherReq,g,set.id,item,node,'应用缓存解释问题');
 const initial=runAssessment(s,l,g,r);finish(l,g,r,initial);
 const proposal=l.proposeRoadmap({goal_id:g,title:'双主题路线',summary:'两个主题各自独立',request_id:id(),phases:[{title:'基础',topics:[{key:'base',title:'缓存原理',requirement_ids:[r],resource_ids:[],dependencies:[],sessions:[{title:'基础学习',objective:'解释原理'}]}]},{title:'应用',topics:[{key:'apply',title:'应用解释',requirement_ids:[otherReq],resource_ids:[],dependencies:[],sessions:[{title:'应用学习',objective:'应用解释'}]}]}]});l.decide({id:proposal.proposal_id,accept:true});
 const addPrimary=(title,content)=>{const row=s.resource({title}),attached=s.attachResource({resource_id:row.id,goal_id:g,role:'PRIMARY',scope:'补充章节',body_content:content,supplement_required:true,request_id:id()}),body=l.state(g).material_contents.find(x=>x.resource_id===row.id);l.analyzeMaterial({goal_id:g,content_id:body.id,status:'ANALYZED',summary:'分析了补充章节',request_id:id()});return attached.resource_id;};
 const first=addPrimary('新增主材 A','A 的正文');
 assert.match(learningView(s.overview(),g),/发起局部补充诊断/);
 const supplementRequest={goal_id:g,kind:'MATERIAL_SUPPLEMENT',mode:'CLOSED_BOOK',scope:'补充验证 A',requirement_ids:[r],resource_ids:[first],request_id:id()},targetA=l.begin(supplementRequest);
 assert.deepEqual(l.begin(supplementRequest),targetA);assert.throws(()=>l.begin({...supplementRequest,request_id:id()}),/已有进行中的补诊/);
 assert.match(learningView(s.overview(),g),/继续补充诊断/);
 assert.deepEqual(l.state(g).goal_resources.find(x=>x.id===first).supplement_requirement_ids,[r]);
 assert.throws(()=>l.begin({goal_id:g,kind:'LEARN',mode:'CLOSED_BOOK',requirement_ids:[r],request_id:id()}),/对应的局部补充诊断/);
 const unaffected=l.begin({goal_id:g,kind:'LEARN',mode:'CLOSED_BOOK',requirement_ids:[otherReq],request_id:id()});l.endEarly({id:unaffected.assessment_id});
 const outside=relatedGoal(s,'完全独立目标','其他领域'),outsideDiag=runAssessment(s,l,outside.g,outside.r);finish(l,outside.g,outside.r,outsideDiag);const outsideRoute=roadmap(l,outside.g,outside.r);l.decide({id:outsideRoute.proposal_id,accept:true});
 assert.ok(l.begin({goal_id:outside.g,kind:'LEARN',mode:'CLOSED_BOOK',requirement_ids:[outside.r],request_id:id()}).assessment_id);
 l.endEarly({id:targetA.assessment_id});assert.equal(l.state(g).goal_resources.find(x=>x.id===first).supplement_status,'COMPLETED');
 assert.ok(l.begin({goal_id:g,kind:'LEARN',mode:'CLOSED_BOOK',requirement_ids:[r],request_id:id()}).assessment_id);
 const second=addPrimary('新增主材 B','B 的正文'),targetB=runAssessment(s,l,g,otherReq,'MATERIAL_SUPPLEMENT',{resource_ids:[second],scope:'补充验证 B'});
 finish(l,g,otherReq,targetB);assert.equal(l.state(g).goal_resources.find(x=>x.id===second).supplement_status,'COMPLETED');
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

function relatedGoal(s, title, domain='AI Infra') {
 const {goal,conversation}=s.createGoal({title,domain});
 const items=[{title:'缓存',kind:'CORE',requirements:[{node:'KV Cache',description:'在新场景解释 K/V 复用'}]}];
 const proposal=s.learning.proposeCapabilities({goal_id:goal.id,items,request_id:id()});
 s.learning.confirmCapabilities({id:proposal.proposal_id,accept:true});
 return {g:goal.id,r:s.learning.state(goal.id).requirements[0].id,c:conversation.id};
}

test('prior learning uses actual answers from other goals and the accepted requirement version',t=>{
 const {s,l,g,r}=setup(t),next=relatedGoal(s,'调度'),unrelated=relatedGoal(s,'同名概念','其他领域');
 const first=runAssessment(s,l,g,r);
 assert.deepEqual(priorLearning(s.db,next.g),[],'unfinished rounds cannot serve as evidence');
 const old=finish(l,g,r,first);
 const [match]=priorLearning(s.db,next.g);
 assert.equal(match.evidence_id,old.evidence_id);
 assert.equal(match.requirement_id,next.r);
 assert.equal(match.source_requirement_id,r);
 assert.match(match.answer,/当前查询/);
 assert.match(match.question,/缓存 Q/);
 assert.match(match.feedback,/复用/);
 assert.deepEqual(priorLearning(s.db,g),[]);
 assert.deepEqual(priorLearning(s.db,unrelated.g),[]);
 assert.deepEqual(previouslyAssessedNodes(s.db,next.g),['KV Cache']);
 assert.deepEqual(previouslyAssessedNodes(s.db,unrelated.g),[]);
 assert.equal(s.context(next.c).learning.prior_learning,undefined,'unrelated planning chat does not receive old answers');
 const check=runAssessment(s,l,next.g,next.r,'INCREMENTAL_DIAGNOSTIC');
 assert.equal(s.context(check.conversation_id).learning.prior_learning[0].assessment_id,first.assessment_id);
 assert.throws(()=>finish(l,next.g,next.r,check,{readiness:[{readiness_id:l.state(next.g).readiness_items[0].id,judgment:'误引用',evidence_ids:[old.evidence_id]}]}),/本目标/);
 assert.equal(s.overview().evidence.length,1);
 finish(l,next.g,next.r,check);
 const revised=l.proposeCapabilities({goal_id:next.g,items:[{title:'新要求',kind:'CORE',requirements:[{node:'调度公平性',description:'解释饥饿'}]}],request_id:id()});
 l.confirmCapabilities({id:revised.proposal_id,accept:true});
 assert.deepEqual(priorLearning(s.db,next.g),[],'superseded targets do not match');
 assert.equal(l.rounds({id:first.assessment_id})[0].answer,match.answer);
});

test('a confirmed roadmap can cite a previous goal; conflicting evidence arriving during confirmation requires verification',t=>{
 const {s,l,g,r}=setup(t),next=relatedGoal(s,'调度');
 const supporting=finish(l,g,r,runAssessment(s,l,g,r));
 const initial=runAssessment(s,l,next.g,next.r);
 finish(l,next.g,next.r,initial);
 const choice={requirement_id:next.r,source_requirement_id:r,evidence_id:supporting.evidence_id,action:'BUILD_ON',reason:'原要求已独立答对，本次直接进入应用'};
 function plan(basis){
  const topic={key:'use',title:'应用',requirement_ids:[next.r],resource_ids:[],dependencies:[],sessions:[{title:'比较调度',objective:'在调度场景解释缓存'}],prior_learning:[basis]};
  return l.proposeRoadmap({goal_id:next.g,title:'应用路线',summary:'沿用已验证的基础',request_id:id(),phases:[{title:'进阶',topics:[topic]}]});
 }
 assert.throws(()=>plan({...choice,evidence_id:id()}),/已完成考察/);
 assert.throws(()=>plan({...choice,requirement_id:r}),/本主题/);
 const p=plan(choice);
 const contrary=runAssessment(s,l,g,r,'FREE_TEST');
 finish(l,g,r,contrary,{relations:[{requirement_id:r,relation:'CONTRADICTS'}]});
 assert.throws(()=>l.decide({id:p.proposal_id,accept:true}),/先短测/);
 assert.equal(s.overview().sessions.length,0);
 assert.deepEqual(new Set(priorLearning(s.db,next.g).map(x=>x.relation)),new Set(['SUPPORTS','CONTRADICTS']));
 l.decide({id:p.proposal_id,accept:false});
 const verify=plan({...choice,action:'VERIFY_FIRST',reason:'前后表现不同，先短测'});
 l.decide({id:verify.proposal_id,accept:true});
 assert.equal(s.overview().sessions.length,1);
 assert.equal(l.state(next.g).roadmap_details.find(d=>d.proposal_id===verify.proposal_id).structure[0].topics[0].prior_learning[0].evidence_id,supporting.evidence_id);
 assert.throws(()=>l.endGoal({id:next.g,status:'COMPLETED'}),/最终/);
 finish(l,next.g,next.r,runAssessment(s,l,next.g,next.r,'INCREMENTAL_DIAGNOSTIC'));
 assert.ok(plan(choice).proposal_id,'fresh local supporting answer can justify building on the history');
});

test('history excerpts and controls are scoped, escaped, and never synthesize an answer',t=>{
 const {s,l,g,r}=setup(t),next=relatedGoal(s,'调度');
 for(let i=0;i<4;i++)finish(l,g,r,runAssessment(s,l,g,r,'FREE_TEST'));
 const rows=priorLearning(s.db,next.g);
 assert.equal(rows.length,3);assert.equal(rows[0].total,4);
 const html=priorLearningView([{...rows[0],answer:'<img src=x onerror=bad()>',source_goal:'<old>'}],true);
 assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<old>/);
 assert.match(html,new RegExp('data-id="'+next.r+'"'));assert.match(html,/查看原考察全部问答/);
 assert.doesNotMatch(priorLearningView(rows,false),/v2-prior-check/);
 assert.match(priorLearningView([],true),/还没有/);
});

test('opening an existing learning library preserves its prompt revisions and takes one pre-upgrade backup',t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-canonical-upgrade-')),file=join(dir,'teacher.sqlite');
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const old=new DatabaseSync(file);
 old.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
 old.prepare('INSERT INTO goals VALUES(?,?,?,?,?,?)').run('existing','旧目标','缓存','','INITIALIZING','2026-09-01');
 old.close();
 let s=createStore(file);
 const prompt=()=>s.db.prepare("SELECT content,version,updated_at FROM prompts WHERE id='teacher'").get();
 const saved=prompt();s.db.close();s=createStore(file);assert.deepEqual(prompt(),saved);
 s.savePrompt('我自定义的 Teacher 提示词');const custom=prompt();s.db.close();s=createStore(file);
 assert.deepEqual(prompt(),custom);s.db.close();
 const copies=readdirSync(join(dir,'backups')).filter(n=>n.startsWith('before-canonical-v1-'));
 assert.equal(copies.length,1);
 const backup=new DatabaseSync(join(dir,'backups',copies[0]),{readOnly:true});
 assert.equal(backup.prepare("SELECT title FROM goals WHERE id='existing'").get().title,'旧目标');
 assert.equal(backup.prepare("SELECT name FROM sqlite_master WHERE name='material_maps'").get(),undefined);
 backup.close();
});
