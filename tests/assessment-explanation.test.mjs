import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore,id} from '../server/store.mjs';
import {learningTools} from '../server/learning-tools.mjs';
import {executionTools} from '../server/agent-policy.mjs';
import {modelExecutor} from '../server/model-executor.mjs';

function setup(t,file=':memory:'){
 const s=createStore(file);t.after(()=>{if(s.db.isOpen)s.db.close();});
 const g=s.createGoal({title:'理解缓存',domain:'AI Infra'}).goal.id,l=s.learning;
 const p=l.proposeCapabilities({goal_id:g,request_id:id(),items:[{title:'缓存',kind:'CORE',requirements:[{node:'KV Cache',description:'解释缓存复用'}]}]});l.confirmCapabilities({id:p.proposal_id,accept:true});
 const r=l.state(g).requirements[0].id,a=l.begin({goal_id:g,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',scope:'缓存复用',requirement_ids:[r],resource_ids:[],request_id:id()});
 const first=s.claim('test',a.conversation_id).job,q=l.question({assessment_id:a.assessment_id,job_id:first.id,lease_token:first.lease_token,question:'为什么缓存 K/V？',requirement_ids:[r],request_id:id()});
 s.send(a.conversation_id,'我还不会，请先讲解。',id());const job=s.claim('test',a.conversation_id).job;
 return {s,l,g,r,a,q,job,args:{round_id:q.round_id,job_id:job.id,lease_token:job.lease_token,content:'历史 token 的 K/V 会被后续查询反复使用，所以可以缓存复用。',request_id:id()}};
}

test('private assessment feedback does not publish teaching; explicit explanation persists before next question',t=>{
 const {s,l,r,a,q,job,args}=setup(t),privateText='私有评分：证据不足，不可判断掌握';
 const receipt=l.feedback({round_id:q.round_id,feedback:privateText,request_id:id()});
 assert.equal(receipt.visibility,'AFTER_ASSESSMENT');assert.equal(receipt.published,false);
 assert.equal(l.rounds({id:a.assessment_id})[0].feedback,null);
 assert.equal(s.db.prepare('SELECT count(*) n FROM messages WHERE content=?').get(privateText).n,0);
 const published=l.explanation(args);assert.equal(published.visibility,'PUBLIC');assert.equal(published.published,true);
 assert.equal(s.db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id).status,'RUNNING');
 assert.equal(s.db.prepare('SELECT status FROM assessments WHERE id=?').get(a.assessment_id).status,'WAITING_HOST');
 assert.equal(s.overview().evidence.length,0);
 assert.equal(l.context(a.conversation_id).assessment.rounds[0].explanation,args.content);
 assert.equal(l.rounds({id:a.assessment_id})[0].explanation_message_id,published.message_id);
 assert.deepEqual(l.explanation(args),published);
 assert.equal(l.explanation({...args,request_id:id()}).message_id,published.message_id);
 assert.throws(()=>l.explanation({...args,content:'替换讲解',request_id:id()}),/已发布/);
 const next=l.question({assessment_id:a.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'现在比较 K 与 V 的用途。',requirement_ids:[r],request_id:id()});
 const messages=s.db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY rowid').all(a.conversation_id),lessonIndex=messages.findIndex(m=>m.id===published.message_id);
 assert.ok(lessonIndex>=0&&lessonIndex<messages.findIndex(m=>m.id===next.message_id));
 assert.equal(messages[lessonIndex].reply_to,null,'terminal question retains the one-reply-per-job binding');
 assert.equal(l.rounds({id:a.assessment_id})[0].feedback,null);
 assert.throws(()=>l.explanation({...args,request_id:id()}),/等待处理|领取已失效/);
});

test('pause preserves the question and invalidates an in-flight lease; early ending queues a scoped comment',t=>{
 const {s,l,g,a,q,job}=setup(t);
 l.pause({id:a.assessment_id});
 assert.equal(l.state(g).assessments[0].status,'PAUSED');
 assert.throws(()=>s.leased(job.id,job.lease_token),/失效/);
 assert.equal(s.claim('paused',a.conversation_id).job,null);
 l.resume({id:a.assessment_id});
 const resumed=s.claim('resumed',a.conversation_id).job;
 assert.equal(resumed.id,job.id);
 assert.notEqual(resumed.lease_token,job.lease_token);
 assert.equal(l.rounds({id:a.assessment_id})[0].id,q.round_id);
 const ended=l.endEarly({id:a.assessment_id});
 assert.equal(l.comment({id:a.assessment_id}).job_id,ended.job_id);
 const {job:comment,context}=s.claim('comment',a.conversation_id);
 assert.equal(comment.id,ended.job_id);
 assert.equal(context.learning.assessment,null);
 assert.equal(context.assessment_comment.answered[0].answer,'我还不会，请先讲解。');
 assert.deepEqual(executionTools({module:'assessment'},context),['teacher_reply']);
 s.reply({job_id:comment.id,lease_token:comment.lease_token,content:'这次尚未独立说明缓存复用，后续可从 K/V 的作用继续。',request_id:id()});
 assert.match(l.state(g).assessments[0].summary,/尚未独立说明/);
 assert.equal(s.overview().evidence.length,0);
 const next=l.continueEnded({id:a.assessment_id,request_id:id()});
 assert.notEqual(next.conversation_id,a.conversation_id);
 assert.deepEqual(l.continueEnded({id:a.assessment_id,request_id:id()}),next);
 assert.equal(l.state(g).assessments.find(row=>row.id===next.assessment_id).parent_id,a.assessment_id);
 assert.equal(l.rounds({id:a.assessment_id}).length,1);
});

test('API ending comment retries without creating evidence or reopening the assessment',async t=>{
 const {s,l,g,a}=setup(t),comment='这次回答表明需要补讲，尚未验证对缓存的理解。';
 const profile=s.models.save({name:'mock',base_url:'https://models.example/v1',model:'mock',key:'test-only'});
 s.models.routes({routes:[{module:'assessment',profile_id:profile.id}]});s.models.enabled(true);
 const ended=l.endEarly({id:a.assessment_id});
 let calls=0;
 const executor=modelExecutor(s,{intervalMs:1000000,fetcher:async(_url,opts)=>{
  const body=JSON.parse(opts.body);
  assert.ok(!body.tools?.length);
  assert.match(body.messages[1].content,/我还不会，请先讲解/);
  if(++calls===1)return new Response('{}',{status:401});
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:comment}}]}));
 }});
 t.after(()=>executor.stop());
 await executor.tick();
 assert.equal(s.models.state().tasks.find(row=>row.job_id===ended.job_id).blocked,1);
 assert.equal(l.state(g).assessments[0].status,'ENDED_EARLY');
 s.models.reroute({job_id:ended.job_id,mode:'API',profile_id:profile.id});
 await executor.tick();
 assert.equal(calls,2);
 assert.equal(l.state(g).assessments[0].summary,comment);
 assert.equal(s.overview().evidence.length,0);
});

test('explanation requires live lease, current answered round and feedback remains a next-question gate',t=>{
 const {s,l,r,a,q,job,args}=setup(t);
 assert.throws(()=>l.explanation({...args,job_id:undefined,request_id:id()}),/领取已失效/);
 assert.throws(()=>l.explanation({...args,lease_token:'wrong',request_id:id()}),/领取已失效/);
 l.explanation(args);
 assert.throws(()=>l.question({assessment_id:a.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'下一题',requirement_ids:[r],request_id:id()}),/反馈/);
 assert.equal(s.overview().evidence.length,0);
 l.feedback({round_id:q.round_id,feedback:'用户尚不会；讲解后的回答需另作判断',request_id:id()});
 l.question({assessment_id:a.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'请独立解释',requirement_ids:[r],request_id:id()});
 s.send(a.conversation_id,'我理解了',id());const current=s.claim('test',a.conversation_id).job;
 assert.throws(()=>l.explanation({...args,job_id:current.id,lease_token:current.lease_token,request_id:id()}),/当前回答/);
 assert.equal(l.rounds({id:a.assessment_id})[1].explanation,null);
 assert.throws(()=>l.feedback({round_id:q.round_id,job_id:current.id,lease_token:current.lease_token,feedback:'旧题补写',request_id:id()}),/当前回答/);
});

test('bound feedback validates live answer scope and retries identical content without overwriting evaluation',t=>{
 const {s,l,q,job}=setup(t),args={round_id:q.round_id,job_id:job.id,lease_token:job.lease_token,feedback:'尚不能独立解释，需后续验证',request_id:id()};
 assert.throws(()=>l.feedback({...args,lease_token:'expired',request_id:id()}),/领取已失效/);
 const first=l.feedback(args);assert.deepEqual(l.feedback({...args,request_id:id()}),first);
 assert.throws(()=>l.feedback({...args,feedback:'改成已掌握',request_id:id()}),/不能覆盖/);
 assert.equal(s.db.prepare('SELECT feedback FROM assessment_rounds WHERE id=?').get(q.round_id).feedback,args.feedback);
 assert.equal(s.overview().evidence.length,0);
});

test('published explanation survives store reload without making private feedback public',t=>{
 const dir=mkdtempSync(join(tmpdir(),'teacher-explanation-'));
 const file=join(dir,'teacher.sqlite'),{s,l,a,q,args}=setup(t,file);
 l.feedback({round_id:q.round_id,feedback:'隐藏评价',request_id:id()});const published=l.explanation(args);s.db.close();
 const reopened=createStore(file);t.after(()=>{reopened.db.close();rmSync(dir,{recursive:true,force:true});});
 const round=reopened.learning.rounds({id:a.assessment_id})[0];assert.equal(round.explanation,args.content);assert.equal(round.explanation_message_id,published.message_id);assert.equal(round.feedback,null);
 assert.equal(reopened.db.prepare('SELECT count(*) n FROM messages WHERE content=?').get(args.content).n,1);
});

test('public explanation tool is available only for structured assessment roles',()=>{
 assert.ok(learningTools.teacher_assessment_explanation);
 for(const module of ['assessment','review','final'])assert.ok(executionTools({module},{}).includes('teacher_assessment_explanation'));
 assert.ok(!executionTools({module:'chat'},{}).includes('teacher_assessment_explanation'));
 assert.deepEqual(executionTools({module:'assessment'},{conversation:{kind:'SESSION_LEARNING'}}),['teacher_reply']);
});

test('API executor publishes lesson before continuing, using its bound lease and preserving private grading',async t=>{
 const {s,l,r,a,q,job}=setup(t);s.db.prepare("UPDATE jobs SET status='QUEUED',lease_token=NULL,lease_until=NULL WHERE id=?").run(job.id);
 const profile=s.models.save({name:'mock',base_url:'https://models.example/v1',model:'mock',key:'test-only',options:{max_tokens:3000}});
 s.models.routes({routes:[{module:'assessment',profile_id:profile.id}]});s.models.enabled(true);s.models.reroute({job_id:job.id,mode:'API',profile_id:profile.id});
 const tool=(name,args)=>({id:id(),type:'function',function:{name,arguments:JSON.stringify(args)}}),lesson='公开教学：缓存复用历史 token 的 K/V，当前查询仍计算自己的 Q。',grading='私有评价：尚不能独立解释';let step=0;
 const x=modelExecutor(s,{intervalMs:1000000,fetcher:async(_url,opts)=>{
  const body=JSON.parse(opts.body);assert.ok(body.tools.some(t=>t.function.name==='teacher_assessment_explanation'));step++;
  let calls;if(step===1)calls=[tool('teacher_assessment_feedback',{round_id:q.round_id,feedback:grading})];
  else if(step===2){assert.ok(body.messages.some(m=>m.role==='tool'&&JSON.parse(m.content).published===false));calls=[tool('teacher_assessment_explanation',{round_id:q.round_id,content:lesson})];}
  else{assert.ok(body.messages.some(m=>m.role==='tool'&&JSON.parse(m.content).published===true));calls=[tool('teacher_assessment_question',{question:'根据刚才可见的讲解，请说明 Q 的用途。',requirement_ids:[r]})];}
  return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:calls}}]}),{headers:{'Content-Type':'application/json'}});
 }});t.after(()=>x.stop());await x.tick();
 assert.equal(step,3);assert.equal(s.models.state().runs[0].status,'COMPLETED');
 const messages=s.messages(a.conversation_id);assert.equal(messages.at(-2).content,lesson);assert.match(messages.at(-1).content,/刚才可见/);assert.ok(!messages.some(m=>m.content===grading));
 assert.equal(l.rounds({id:a.assessment_id})[0].feedback,null);assert.equal(s.overview().evidence.length,0);
});
