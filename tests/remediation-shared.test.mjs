import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore,id} from '../server/store.mjs';
import {remediationScheduleDialog} from '../public/remediation.js';

function fixture(t){
 const s=createStore(':memory:');t.after(()=>s.db.close());const L=s.learning;
 const source=s.createGoal({title:'来源目标',domain:'测试'}),target=s.createGoal({title:'补学目标',domain:'测试'}),g=target.goal.id;
 const p=L.proposeCapabilities({goal_id:g,items:[{title:'核心能力',kind:'CORE',requirements:[{node:'顺序',description:'解释运算顺序'}]}],request_id:id()});L.confirmCapabilities({id:p.proposal_id,accept:true});
 const req=L.state(g).requirements[0].id,a=L.begin({goal_id:g,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',requirement_ids:[req],request_id:id()});
 const job=s.claim('隔离测试',a.conversation_id).job,q=L.question({assessment_id:a.assessment_id,job_id:job.id,lease_token:job.lease_token,question:'解释顺序',requirement_ids:[req],request_id:id()});
 s.send(a.conversation_id,'先算外层',id());L.feedback({round_id:q.round_id,feedback:'顺序颠倒',request_id:id()});
 L.finish({assessment_id:a.assessment_id,summary:'需要补学',profile:'顺序待验证',change_summary:'实际回答',relations:[{requirement_id:req,relation:'CONTRADICTS'}],gaps:[{requirement_id:req,description:'顺序混淆',reason:'实际回答顺序错误'}],readiness:[],request_id:id()});
 const road=L.proposeRoadmap({goal_id:g,title:'学习路线',summary:'先学后验证',phases:[{title:'基础',topics:[{key:'order',title:'运算顺序',requirement_ids:[req],resource_ids:[],dependencies:[],sessions:[{title:'例题',objective:'计算例题'}]}]}],request_id:id()});L.decide({id:road.proposal_id,accept:true});
 const shared=s.resource({goal_id:source.goal.id,title:'跨目标共享资料',role:'REFERENCE'}),foreign=s.resource({goal_id:source.goal.id,title:'其他目标未共享资料',role:'REFERENCE'}),unlinked=s.resource({title:'未关联资料',role:'REFERENCE'}),local=s.resource({goal_id:g,title:'本目标资料',role:'REFERENCE'});
 s.attachResource({resource_id:shared.id,goal_id:g,role:'REFERENCE',scope:'第一章',request_id:id()});
 const gap=L.state(g).gaps[0],request=()=>({gap_id:gap.id,date:'2026-11-10',duration:20,activity:'回看例题并重新计算',resource_ids:[shared.id,local.id],request_id:id()});
 return {s,g,gap,shared,foreign,unlinked,local,request};
}

test('remediation accepts formally shared resources and preserves evidence and replay behavior',t=>{
 const {s,g,gap,shared,local,request}=fixture(t),input=request();
 assert.notEqual(s.db.prepare('SELECT goal_id FROM resources WHERE id=?').get(shared.id).goal_id,g);
 const before=s.overview().evidence,result=s.remediation.schedule(input);
 assert.deepEqual(s.remediation.schedule(input),result);
 assert.equal(s.calendar.state().length,1);
 assert.deepEqual(s.remediation.state()[0].resource_ids,[shared.id,local.id]);
 assert.equal(s.remediation.state()[0].evidence_id,gap.evidence_id);
 assert.deepEqual(s.overview().evidence,before);
});

test('remediation rejects foreign and unlinked resources without creating partial plans',t=>{
 const {s,foreign,unlinked,request}=fixture(t);
 for(const resource of [foreign,unlinked])assert.throws(()=>s.remediation.schedule({...request(),resource_ids:[resource.id]}),/资料必须属于当前目标/);
 assert.equal(s.calendar.state().length,0);assert.equal(s.remediation.state().length,0);
});

test('remediation picker offers current goal associations and submits the shared resource',async t=>{
 const {s,gap,shared,foreign,unlinked,local}=fixture(t);let html,submit,sent;
 remediationScheduleDialog(s.overview(),gap.id,{dialog(_title,body,onSubmit){html=body;submit=onSubmit;},async api(route,input){sent={route,input};return s.remediation.schedule(input);},toast(){}});
 for(const resource of [shared,local])assert.ok(html.includes('name="resource_'+resource.id+'"'));
 for(const resource of [foreign,unlinked])assert.ok(!html.includes('name="resource_'+resource.id+'"'));
 await submit({date:'2026-11-10',duration:'20',activity:'回看共享资料',['resource_'+shared.id]:'on'});
 assert.equal(sent.route,'remediation/schedule');assert.deepEqual(sent.input.resource_ids,[shared.id]);
 assert.deepEqual(s.remediation.state()[0].resource_ids,[shared.id]);
});
