import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore,id} from '../server/store.mjs';
import {tools,callJobTool} from '../server/tools.mjs';
import {messageChoiceSchema} from '../server/message-choices.mjs';
import {modelExecutor} from '../server/model-executor.mjs';
import {agentCatalog,agentInvoke} from '../server/agent-mcp.mjs';
import {startServer} from '../server/index.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
const choice={type:'SINGLE',options:[{id:'A',text:'复用已有 K/V'},{id:'B',text:'重新计算所有 K/V'}]},multi={...choice,type:'MULTIPLE'};
function setup(t){const s=createStore(':memory:');t.after(()=>s.db.close());const g=s.createGoal({title:'缓存',domain:'推理'});return {s,c:g.conversation.id,g:g.goal.id};}
function ask(s,c,definition=choice){s.send(c,'请提问',id());const job=s.claim('choices',c).job;return s.reply({job_id:job.id,lease_token:job.lease_token,content:'缓存如何工作？',choice:definition,request_id:id()}).message_id;}
const select=(s,c,q,ids=['A'],key=id())=>s.send(c,undefined,key,undefined,undefined,{question_message_id:q,option_ids:ids});
const count=(s,table)=>s.db.prepare('SELECT count(*) AS n FROM '+table).get().n;

test('strict public schema rejects answer keys, unsafe or duplicate IDs, unbounded options and text',()=>{
 assert.deepEqual(messageChoiceSchema.parse(choice),choice);
 for(const x of [{...choice,correct:'A'},{...choice,score:1},{...choice,options:[{id:'A',text:'one',correct:true},choice.options[1]]},{...choice,options:[choice.options[0],choice.options[0]]},{...choice,options:[{id:'<script>',text:'x'},choice.options[1]]},{...choice,options:[choice.options[0]]},{...choice,options:Array.from({length:9},(_,i)=>({id:String(i),text:'x'}))},{...choice,options:[{id:'A',text:'x'.repeat(2001)},choice.options[1]]}])assert.equal(messageChoiceSchema.safeParse(x).success,false);
 for(const name of ['teacher_reply','teacher_assessment_question'])assert.ok(tools[name].schema.shape.choice);
 for(const role of ['chat','assessment','review','final'])for(const name of ['teacher_reply',...(role==='chat'?[]:['teacher_assessment_question'])])assert.ok(agentCatalog(role).find(x=>x.name===name).schema.shape.choice);
});

test('canonical selection is atomic and retries bind question and selection across new questions',t=>{
 const {s,c}=setup(t),q=ask(s,c,multi),key=id();assert.equal(s.messages(c).at(-1).choice.status,'OPEN');
 const before=count(s,'messages'),answer=select(s,c,q,['B','A'],key);assert.equal(s.messages(c).at(-1).content,'A. 复用已有 K/V\nB. 重新计算所有 K/V');assert.equal(count(s,'messages'),before+1);assert.equal(count(s,'evidence'),0);
 assert.deepEqual(select(s,c,q,['A','B'],key),answer);assert.throws(()=>select(s,c,q,['A'],key),/request_id/);assert.throws(()=>select(s,c,q,['A']),/已回答/);
 const job=s.claim('next',c).job;s.reply({job_id:job.id,lease_token:job.lease_token,content:'下一题',choice,request_id:id()});assert.deepEqual(select(s,c,q,['A','B']),answer);
 const card=s.messages(c).find(m=>m.id===q).choice;assert.deepEqual(card.selected_option_ids,['A','B']);assert.equal(card.answer_message_id,answer.message_id);assert.equal(card.status,'ANSWERED');
});

test('invalid, cross-conversation, stale and paused selections create no answer or receipt',t=>{
 const {s,c,g}=setup(t),q=ask(s,c),before=['messages','jobs','receipts','message_choice_answers'].map(x=>count(s,x));
 for(const ids of [[],['A','B'],['C'],['A','A']])assert.throws(()=>select(s,c,q,ids));
 const foreign=s.newConversation(g,'另一个对话');assert.throws(()=>select(s,foreign.id,q),/不属于/);assert.deepEqual(['messages','jobs','receipts','message_choice_answers'].map(x=>count(s,x)),before);
 s.db.prepare("UPDATE goals SET status='PAUSED' WHERE id=?").run(g);assert.equal(s.messages(c).at(-1).choice.status,'DISABLED');assert.throws(()=>select(s,c,q),/只读/);s.db.prepare("UPDATE goals SET status='ACTIVE' WHERE id=?").run(g);
 s.send(c,'换个问题',id());assert.equal(s.messages(c).find(m=>m.id===q).choice.status,'STALE');assert.throws(()=>select(s,c,q),/失效/);
});

test('database failure rolls back canonical message, job, receipts and selection together',t=>{
 const {s,c}=setup(t),q=ask(s,c),key=id(),before=['messages','jobs','receipts','message_choice_answers'].map(x=>count(s,x));
 s.db.exec("CREATE TRIGGER fail_choice BEFORE INSERT ON message_choice_requests BEGIN SELECT RAISE(ABORT,'injected failure'); END;");assert.throws(()=>select(s,c,q,['A'],key),/injected/);assert.deepEqual(['messages','jobs','receipts','message_choice_answers'].map(x=>count(s,x)),before);assert.equal(s.messages(c).at(-1).choice.status,'OPEN');s.db.exec('DROP TRIGGER fail_choice');select(s,c,q,['A'],key);
});

test('three queued interactions retain all historical cards and only latest question accepts clicks',t=>{
 const {s,c}=setup(t);for(let i=0;i<3;i++)s.send(c,'排队消息 '+i,id());const cards=[];
 for(let i=0;i<3;i++){const job=s.claim('queue',c).job;cards.push(s.reply({job_id:job.id,lease_token:job.lease_token,content:'问题 '+i,choice,request_id:id()}).message_id);}
 assert.deepEqual(s.messages(c).filter(m=>m.choice).map(m=>m.choice.status),['STALE','STALE','OPEN']);for(const q of cards.slice(0,2))assert.throws(()=>select(s,c,q),/失效/);select(s,c,cards[2]);assert.equal(s.messages(c).filter(m=>m.choice).length,3);
});

test('two formal rounds route both selection and typed answers through existing feedback and evidence',t=>{
 const {s,g}=setup(t),L=s.learning,p=L.proposeCapabilities({goal_id:g,request_id:id(),items:[{title:'缓存机制',kind:'CORE',requirements:[{node:'KV',description:'解释缓存复用'}]}]});L.confirmCapabilities({id:p.proposal_id,accept:true});const req=L.state(g).requirements[0].id;
 const a=L.begin({goal_id:g,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',scope:'缓存机制',requirement_ids:[req],resource_ids:[],request_id:id()}),c=a.conversation_id;
 let heldJob;const question=()=>{const job=heldJob||s.claim('formal',c).job;heldJob=job;const out=L.question({assessment_id:a.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'解释缓存复用',choice,requirement_ids:[req],request_id:id()});heldJob=null;return out;};
 const q1=question();assert.throws(()=>s.reply({job_id:s.db.prepare('SELECT id FROM jobs WHERE conversation_id=? ORDER BY rowid DESC LIMIT 1').get(c).id,lease_token:'invalid',content:'不走考察工具',choice,request_id:id()}),/结构化考察/);const key=id(),answer1=select(s,c,q1.message_id,['A'],key);assert.throws(question,/先保存/);L.feedback({round_id:q1.round_id,feedback:'根据用户选择追问理由',request_id:id()});const q2=question();assert.deepEqual(select(s,c,q1.message_id,['A']),answer1);const answer2=s.send(c,'复用前缀对应的 K/V，减少重复计算。',id());assert.equal(s.messages(c).find(m=>m.id===q2.message_id).choice.status,'ANSWERED');assert.deepEqual(s.messages(c).find(m=>m.id===q2.message_id).choice.selected_option_ids,[]);assert.throws(()=>select(s,c,q2.message_id),/失效/);
 L.feedback({round_id:q2.round_id,feedback:'解释覆盖复用前提',request_id:id()});L.finish({assessment_id:a.assessment_id,summary:'真实回答的总结',profile:'能解释复用',change_summary:'正式考察记录',relations:[{requirement_id:req,relation:'SUPPORTS'}],gaps:[],request_id:id()});assert.deepEqual(JSON.parse(s.overview().evidence[0].source_message_ids),[answer1.message_id,answer2.message_id]);assert.equal(L.rounds({id:a.assessment_id})[0].answer,'A. 复用已有 K/V');assert.deepEqual(L.rounds({id:a.assessment_id})[0].choice.options,choice.options);assert.equal(L.rounds({id:a.assessment_id})[0].choice.status,'ANSWERED');
});

test('HTTP selection works without content and rejects unknown fields without leaking answer keys',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-choice-api-')),app=startServer({port:0,dataDir:dir});await once(app.server,'listening');t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});const base='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0],s=app.store,c=s.createGoal({title:'缓存',domain:'推理'}).conversation.id,q=ask(s,c),state=await(await fetch(base+'/api/state',{headers:{cookie}})).json();
 const post=body=>fetch(base+'/api/messages',{method:'POST',headers:{'Content-Type':'application/json',cookie,'x-csrf-token':state.csrf},body:JSON.stringify({conversation_id:c,request_id:id(),...body})});
 const bad=await post({choice_answer:{question_message_id:q,option_ids:['A'],correct:true}});assert.equal(bad.status,400);assert.equal((await fetch(base+'/message-choices.js')).status,200);const good=await post({choice_answer:{question_message_id:q,option_ids:['A']}});assert.equal(good.status,200);const messages=await(await fetch(base+'/api/messages?conversation_id='+c,{headers:{cookie}})).json();assert.equal(messages.find(m=>m.id===q).choice.status,'ANSWERED');assert.equal(messages.at(-1).content,'A. 复用已有 K/V');
});

test('API model executor publishes structured choice via terminal reply with no added business permissions',async t=>{
 const {s,g}=setup(t),p=s.propose({goal_id:g,title:'路线',summary:'任务',items:[{title:'缓存',objective:'解释缓存复用'}],request_id:id()});s.decide(p.proposal_id,true);const task=s.overview().sessions[0],c=s.sessionLearning.open({session_id:task.id,request_id:id()}).conversation_id;
 const profile=s.models.save({name:'choice-model',base_url:'https://example.test/v1',model:'choice-test',key:''});s.models.routes({routes:[{module:'chat',profile_id:profile.id}]});s.models.enabled(true);let requests=0;
 const driver=modelExecutor(s,{intervalMs:1e9,fetcher:async(_u,options)=>{requests++;const payload=JSON.parse(options.body);assert.deepEqual(payload.tools.map(x=>x.function.name),['teacher_reply']);const schema=payload.tools[0].function.parameters.properties.choice;assert.deepEqual(schema.properties.type.enum,['SINGLE','MULTIPLE']);assert.equal(schema.additionalProperties,false);return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'choice',type:'function',function:{name:'teacher_reply',arguments:JSON.stringify({content:'选择一个解释',choice})}}]}}]}));}});t.after(()=>driver.stop());
 s.send(c,'给一道选择练习',id());await driver.tick();assert.equal(requests,1);assert.equal(s.messages(c).at(-1).choice.status,'OPEN');assert.equal(count(s,'assessments'),0);assert.equal(count(s,'evidence'),0);assert.equal(s.overview().sessions[0].status,'PLANNED');
});

test('scoped chat MCP publishes choice but cannot use it in discovery',t=>{
 const {s,c,g}=setup(t);s.agents.configure({role:'chat',mode:'MCP'});s.send(c,'给个选项',id());let job=agentInvoke(s,'chat','teacher_claim_message',{conversation_id:c}).job;
 agentInvoke(s,'chat','teacher_reply',{job_id:job.id,lease_token:job.lease_token,content:'请选择',choice,request_id:id()});assert.equal(s.messages(c).at(-1).choice.status,'OPEN');
 const d=s.discovery.create({request_id:id()}).conversation_id;s.send(d,'目标方向',id());job=agentInvoke(s,'chat','teacher_claim_message',{conversation_id:d}).job;const before=count(s,'messages');assert.throws(()=>agentInvoke(s,'chat','teacher_reply',{job_id:job.id,lease_token:job.lease_token,content:'请选择',choice,request_id:id()}),/不支持选择题/);assert.equal(count(s,'messages'),before);agentInvoke(s,'chat','teacher_reply',{job_id:job.id,lease_token:job.lease_token,content:'可以继续讨论目标方向',request_id:id()});assert.equal(s.messages(d).at(-1).choice,undefined);
});


test('completed goal remains open for formal review choices under existing review policy',t=>{
 const {s,g}=setup(t),L=s.learning,p=L.proposeCapabilities({goal_id:g,request_id:id(),items:[{title:'缓存机制',kind:'CORE',requirements:[{node:'KV',description:'解释缓存复用'}]}]});L.confirmCapabilities({id:p.proposal_id,accept:true});const req=L.state(g).requirements[0].id;s.db.prepare("UPDATE goals SET status='COMPLETED' WHERE id=?").run(g);
 const a=L.begin({goal_id:g,kind:'REVIEW',mode:'CLOSED_BOOK',scope:'长期复习',requirement_ids:[req],resource_ids:[],request_id:id()}),job=s.claim('review',a.conversation_id).job,q=L.question({assessment_id:a.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'哪项正确？',choice,requirement_ids:[req],request_id:id()});assert.equal(s.messages(a.conversation_id).at(-1).choice.status,'OPEN');const answer=select(s,a.conversation_id,q.message_id);assert.equal(L.rounds({id:a.assessment_id})[0].answer_message_id,answer.message_id);assert.equal(s.messages(a.conversation_id).find(m=>m.id===q.message_id).choice.status,'ANSWERED');
});

test('choice publication on a newly paused planning goal rolls back the assistant message and receipt',t=>{
 const {s,c,g}=setup(t);s.send(c,'准备选择练习',id());const job=s.claim('publisher',c).job,key=id(),before=count(s,'messages');s.db.prepare("UPDATE goals SET status='PAUSED' WHERE id=?").run(g);assert.throws(()=>s.reply({job_id:job.id,lease_token:job.lease_token,request_id:key,content:'选择一项',choice}),/只读/);assert.equal(count(s,'messages'),before);assert.equal(s.db.prepare('SELECT 1 FROM receipts WHERE request_id=?').get(key),undefined);assert.equal(s.db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id).status,'RUNNING');
});
