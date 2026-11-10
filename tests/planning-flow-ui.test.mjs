import test from 'node:test';
import assert from 'node:assert/strict';
import {planningFlowCard,planningFlowAction,planningFlowReminder} from '../public/planning-flow.js';

function state(flow={}){return {goals:[{id:'g',status:'INITIALIZING'}],conversations:[{id:'p',kind:'PLANNING'},{id:'other',kind:'PLANNING'},{id:'quiz',kind:'ASSESSMENT'}],proposals:[],learning:{capability_sets:[]},planning_flow:[{goal_id:'g',conversation_id:'p',status:'ACTIVE',stage:'DIAGNOSIS',title:'初始诊断',suggested_options:[],...flow}]};}
function context(current=state()){
 const calls=[],opened=[],messages=[],card={dataset:{goal:'g',conversation:'p'},querySelectorAll:()=>[],querySelector:()=>null};
 const node={dataset:{id:'cap-pending'},closest:()=>card};
 const env={getState:()=>current,api:async(path,data)=>{calls.push({path,data});return {conversation_id:'quiz'};},refresh:async()=>{},openChat:async(...args)=>opened.push(args),openView:async()=>{},revise:()=>{},toast:message=>messages.push(message)};
 return {env,node,calls,opened,messages};
}
test('review previews use pending proposal id rather than accepted capability set; escaped actual requirements appear',()=>{
 const s=state({stage:'REVIEW_CAPABILITIES',capability_set_id:'old',proposal_id:'cap-pending'});
 s.learning.capability_sets=[{id:'old',status:'ACCEPTED',content:[]},{id:'cap-pending',status:'PENDING',content:[{title:'要求 <script>',requirements:[{node:'题目',description:'解释真正的调用过程'}]}]}];
 const html=planningFlowCard(s,'g','p');
 assert.match(html,/解释真正的调用过程/);assert.match(html,/要求 &lt;script&gt;/);assert.match(html,/planning-accept-cap/);assert.doesNotMatch(html,/<script>/);
 assert.equal(planningFlowCard(s,'g','other'),'');
});
test('diagnostic requires explicit start and provides exact anchor return in assessment chat',()=>{
 const s=state({capability_set_id:'cap-accepted',suggested_options:[{action:'START_DIAGNOSIS'}]});
 assert.match(planningFlowCard(s,'g','p'),/planning-begin-diagnosis" data-id="cap-accepted"/);
 s.planning_flow[0].assessment_conversation_id='quiz';
 const html=planningFlowCard(s,'g','quiz');assert.match(html,/planning-return" data-id="p"/);assert.doesNotMatch(html,/planning-begin-diagnosis/);
});
test('deferred and stopped flows do not retain confirmation controls',()=>{
 for(const status of ['DEFERRED','STOPPED']){
  const html=planningFlowCard(state({status,stage:'REVIEW_CAPABILITIES'}),'g','p');
  assert.match(html,/planning-resume/);assert.doesNotMatch(html,/planning-accept-cap|planning-stop/);
 }
});
test('capability acceptance only records choice; diagnostic start calls endpoint and opens real returned conversation',async()=>{
 const c=context();await planningFlowAction('accept-cap',c.node,c.env);
 assert.equal(c.calls.length,1);assert.equal(c.calls[0].path,'planning-flow/decide');assert.deepEqual({...c.calls[0].data,request_id:'captured'},{goal_id:'g',conversation_id:'p',proposal_id:'cap-pending',accept:true,request_id:'captured'});assert.deepEqual(c.opened,[]);
 c.node.dataset.id='cap-accepted';await planningFlowAction('begin-diagnosis',c.node,c.env);
 assert.equal(c.calls[1].path,'planning-flow/diagnostic');assert.equal(c.calls[1].data.conversation_id,'p');assert.equal(c.calls[1].data.capability_set_id,'cap-accepted');assert.deepEqual(c.opened,[['quiz',{from:'p'}]]);
});
test('double clicks coalesce while a write is pending and failed retry preserves request id',async()=>{
 const c=context();let release;const gate=new Promise(resolve=>release=resolve);
 c.env.api=async(path,data)=>{c.calls.push({path,data});await gate;throw Error('interrupted');};
 const first=planningFlowAction('start',c.node,c.env);await planningFlowAction('start',c.node,c.env);assert.equal(c.calls.length,1);release();await assert.rejects(first,/interrupted/);
 c.env.api=async(path,data)=>{c.calls.push({path,data});return {};};await planningFlowAction('start',c.node,c.env);assert.equal(c.calls[0].data.request_id,c.calls[1].data.request_id);
});
test('adjustment buttons return to the main conversation without writing or opening another editor',async()=>{
 for(const stage of ['REVIEW_CAPABILITIES','REVIEW_ROADMAP','NEEDS_REVISION','BLOCKED']){
  const s=state({proposal_id:'cap-pending',stage}),c=context(s);
  let focused=0,refreshed=0;c.env.revise=()=>focused++;c.env.refresh=async()=>{refreshed++;};
  if(stage==='BLOCKED')c.node.dataset.id='';
  await planningFlowAction('revision',c.node,c.env);
  assert.equal(focused,1);assert.equal(refreshed,0);assert.deepEqual(c.calls,[]);
  assert.doesNotMatch(planningFlowCard(s,'g','p'),/textarea|planning-feedback|planning-save-revision/);
 }
});
test('stale decision and diagnostic clicks retain their rendered subject instead of selecting the current subject',async()=>{
 const s=state({proposal_id:'new-proposal',capability_set_id:'new-set'}),c=context(s);
 for(const action of ['accept-cap','reject-cap','accept-roadmap','reject-roadmap']){
  c.node.dataset.id='previous-proposal';await planningFlowAction(action,c.node,c.env);
  assert.equal(c.calls.at(-1).path,'planning-flow/decide');assert.equal(c.calls.at(-1).data.proposal_id,'previous-proposal');assert.equal(c.calls.at(-1).data.accept,action.startsWith('accept'));
 }
 c.node.dataset.id='previous-set';await planningFlowAction('begin-diagnosis',c.node,c.env);
 assert.equal(c.calls.at(-1).data.capability_set_id,'previous-set');
});
test('diagnostic retry keys are specific to the captured accepted capability set',async()=>{
 const c=context();c.env.api=async(path,data)=>{c.calls.push({path,data});throw Error('lost connection');};
 c.node.dataset.id='set-one';await assert.rejects(planningFlowAction('begin-diagnosis',c.node,c.env));
 await assert.rejects(planningFlowAction('begin-diagnosis',c.node,c.env));
 c.node.dataset.id='set-two';await assert.rejects(planningFlowAction('begin-diagnosis',c.node,c.env));
 assert.equal(c.calls[0].data.request_id,c.calls[1].data.request_id);assert.notEqual(c.calls[1].data.request_id,c.calls[2].data.request_id);
});
test('control and revision requests capture the rendered revision, and completed work has explicit rework action',async()=>{
 const s=state({stage:'BLOCKED',expected_revision:'state-digest',updated_at:'timestamp-not-digest',suggested_options:[{action:'REWORK_JOB',job_id:'job-old'}]}),c=context(s);
 const originalClosest=c.node.closest;c.node.closest=()=>({...originalClosest(),dataset:{goal:'g',conversation:'p',revision:'rendered-revision'}});
 assert.match(planningFlowCard(s,'g','p'),/planning-rework" data-id="job-old"/);assert.match(planningFlowCard(s,'g','p'),/data-revision="state-digest"/);assert.doesNotMatch(planningFlowCard(s,'g','p'),/timestamp-not-digest/);
 await planningFlowAction('stop',c.node,c.env);assert.equal(c.calls[0].data.expected_revision,'rendered-revision');
 c.node.dataset.id='job-old';await planningFlowAction('rework',c.node,c.env);assert.equal(c.calls[1].path,'planning-flow/rework');assert.equal(c.calls[1].data.job_id,'job-old');
});
test('home reminders show genuine enrolled pending decisions and open the exact original planning conversation',()=>{
 const s=state({stage:'REVIEW_CAPABILITIES',proposal_id:'cap-pending'});s.goals[0].title='七天学习 <计划>';s.conversations.forEach(c=>c.goal_id='g');
 s.learning.capability_sets=[{id:'cap-pending',goal_id:'g',status:'PENDING'}];
 let html=planningFlowReminder(s);assert.match(html,/data-chat="p"/);assert.match(html,/七天学习 &lt;计划&gt;/);assert.match(html,/确认能力要求/);
 s.planning_flow[0].stage='REVIEW_ROADMAP';s.planning_flow[0].proposal_id='route-pending';s.proposals=[{id:'route-pending',goal_id:'g',status:'PENDING'}];
 html=planningFlowReminder(s);assert.match(html,/确认学习路线/);assert.match(html,/data-chat="p"/);
 s.proposals[0].status='ACCEPTED';assert.equal(planningFlowReminder(s),'');
 s.planning_flow=[];assert.equal(planningFlowReminder(s),'');
});
test('home diagnosis reminder links pending entry to planning and an actual unanswered question to the actual assessment',()=>{
 const s=state({stage:'DIAGNOSIS',suggested_options:[{action:'START_DIAGNOSIS'}]});s.goals[0].title='诊断目标';s.conversations.forEach(c=>c.goal_id='g');
 assert.match(planningFlowReminder(s),/data-chat="p"/);
 Object.assign(s.planning_flow[0],{assessment_id:'assessment',assessment_conversation_id:'quiz'});
 s.learning.assessments=[{id:'assessment',goal_id:'g',conversation_id:'quiz',status:'WAITING_ANSWER'}];
 assert.match(planningFlowReminder(s),/data-chat="quiz"/);assert.match(planningFlowReminder(s),/继续回答初始诊断/);
 for(const status of ['WAITING_HOST','COMPLETED','ENDED_EARLY']){s.learning.assessments[0].status=status;assert.equal(planningFlowReminder(s),'');}
});
test('home reminders remain absent for deferred, stopped, background working, paused or missing-anchor flows',()=>{
 const s=state({stage:'DIAGNOSIS',suggested_options:[{action:'START_DIAGNOSIS'}]});s.goals[0].title='目标';s.conversations.forEach(c=>c.goal_id='g');
 for(const status of ['DEFERRED','STOPPED']){s.planning_flow[0].status=status;assert.equal(planningFlowReminder(s),'');}
 s.planning_flow[0].status='ACTIVE';s.planning_flow[0].stage='GENERATING_ROADMAP';assert.equal(planningFlowReminder(s),'');
 s.planning_flow[0].stage='DIAGNOSIS';s.goals[0].status='PAUSED';assert.equal(planningFlowReminder(s),'');
 s.goals[0].status='INITIALIZING';s.planning_flow[0].conversation_id='missing';assert.equal(planningFlowReminder(s),'');
});
test('blocked retry uses a scoped service with the rendered job, goal, anchor and revision instead of assuming agent execution',async()=>{
 const s=state({stage:'BLOCKED',expected_revision:'new-flow-revision',job_id:'new-job',suggested_options:[{action:'RETRY_JOB',job_id:'blocked-job',label:'检查并重试任务'}]}),c=context(s);
 const html=planningFlowCard(s,'g','p');assert.match(html,/planning-retry" data-id="blocked-job"/);assert.doesNotMatch(html,/data-action="agent-retry"/);
 const originalClosest=c.node.closest;c.node.closest=()=>({...originalClosest(),dataset:{goal:'original-goal',conversation:'original-anchor',revision:'rendered-flow-revision'}});c.node.dataset.id='rendered-blocked-job';
 await planningFlowAction('retry',c.node,c.env);
 assert.equal(c.calls[0].path,'planning-flow/retry');assert.deepEqual({...c.calls[0].data,request_id:'captured'},{goal_id:'original-goal',conversation_id:'original-anchor',job_id:'rendered-blocked-job',expected_revision:'rendered-flow-revision',request_id:'captured'});
 assert.deepEqual(c.opened,[]);
});
