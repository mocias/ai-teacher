import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createStore,id} from '../server/store.mjs';
import {moduleTools} from '../server/agent-policy.mjs';
import {agentInvoke} from '../server/agent-mcp.mjs';
import {startServer} from '../server/index.mjs';
import {journeyView} from '../public/journey.js';
import {codexHost} from '../server/codex-host.mjs';

function populate(s){
 const g=s.createGoal({title:'理解协议',domain:'计算机'}).goal.id,L=s.learning;
 const cap=items=>{const p=L.proposeCapabilities({goal_id:g,items,request_id:id()});L.confirmCapabilities({id:p.proposal_id,accept:true});};
 cap([{title:'协议原理',kind:'CORE',requirements:[{node:'握手',description:'解释握手顺序'},{node:'重试',description:'说明重试边界'}]},{title:'拓展知识',kind:'SUPPORTING',requirements:[{node:'扩展字段',description:'说明可选扩展字段'}]}]);
 let reqs=L.state(g).requirements.map(r=>r.id),d=L.begin({goal_id:g,kind:'INITIAL_DIAGNOSTIC',mode:'CLOSED_BOOK',request_id:id()});L.endEarly({id:d.assessment_id});
 const p=L.proposeRoadmap({goal_id:g,title:'学习路线',summary:'按要求学习',request_id:id(),phases:[{title:'协议',topics:[{key:'t',title:'协议',requirement_ids:reqs,resource_ids:[],dependencies:[],sessions:[{title:'学习协议',objective:'解释协议'}]}]}]});L.decide({id:p.proposal_id,accept:true});
 const primary=s.resource({goal_id:g,title:'规范正文',role:'PRIMARY',scope:'全篇'}).id,other=s.resource({goal_id:g,title:'补充说明',role:'SUPPLEMENTARY',scope:'全篇'}).id;
 const c1=L.material({goal_id:g,resource_id:primary,scope:'全篇',content:'规范正文版本一'}),c2=L.material({goal_id:g,resource_id:other,scope:'全篇',content:'补充正文版本一'});
 return {s,L,g,reqs,primary,other,c1,c2,cap};
}
function fixture(t){const s=createStore(':memory:');t.after(()=>s.db.close());return populate(s);}

test('important conflict blocks only affected LEARN topics; review and unrelated topic remain available',t=>{
 const {s,L,g,reqs,c1,c2}=fixture(t),[affected,unaffected]=reqs;
 const map=L.materialMap.register({goal_id:g,content_id:c1.id,coverage:[{requirement_id:unaffected,coverage:'COVERED',rationale:'正文直接说明'}],conflicts:[{description:'两份正文对握手是否包含确认步骤说法相反',requirement_ids:[affected],important:true,source_content_ids:[c2.id]}]});
 assert.equal(L.materialMap.blockers(g,[affected]).length,1);assert.equal(L.materialMap.blockers(g,[unaffected]).length,0);
 assert.throws(()=>L.begin({goal_id:g,kind:'LEARN',mode:'CLOSED_BOOK',requirement_ids:[affected],request_id:id()}),/尚未裁决/);
 assert.ok(L.begin({goal_id:g,kind:'LEARN',mode:'CLOSED_BOOK',requirement_ids:[unaffected],request_id:id()}).assessment_id);
 assert.ok(L.begin({goal_id:g,kind:'REVIEW',mode:'CLOSED_BOOK',requirement_ids:[affected],request_id:id()}).assessment_id);
 assert.throws(()=>L.endGoal({id:g,status:'COMPLETED'}),/未裁决的重要资料冲突/);
 assert.deepEqual(s.overview().learning.material_map.conflicts[0].source_content_ids,[c1.id,c2.id]);
 const conflictId=s.overview().learning.material_map.conflicts[0].id;
 assert.throws(()=>L.materialMap.resolve({goal_id:g,conflict_id:conflictId,decision:'ADOPTED',note:'采用某正文',request_id:id()}),/请选择/);
 assert.throws(()=>L.materialMap.resolve({goal_id:g,conflict_id:conflictId,decision:'NO_CONFLICT',note:'  ',request_id:id()}),/裁决理由/);
 assert.equal(L.materialMap.blockers(g,[affected]).length,1);
 const decisionRequest=id(),decision={goal_id:g,conflict_id:conflictId,decision:'ADOPTED',source_content_id:c2.id,note:'补充正文适用的是当前协议版本，采用其限制条件',request_id:decisionRequest};
 assert.equal(L.materialMap.resolve(decision).source_content_id,c2.id);assert.deepEqual(L.materialMap.resolve(decision),L.materialMap.resolve(decision));
 assert.equal(L.materialMap.blockers(g,[affected]).length,0);
 L.materialMap.resolve({...decision,decision:'NO_CONFLICT',source_content_id:undefined,note:'复核确认正文指向不同协议版本',request_id:id()});
 assert.equal(L.materialMap.blockers(g,[affected]).length,0);assert.equal(L.state(g).material_map.conflicts[0].decision_history.length,2);
});

test('an unresolved supporting-only conflict blocks its own LEARN topic but does not gate goal completion',t=>{
 const {L,g,reqs,c1,c2}=fixture(t),supporting=reqs[2];
 L.materialMap.register({goal_id:g,content_id:c1.id,coverage:[],conflicts:[{description:'扩展字段定义冲突',requirement_ids:[supporting],important:true,source_content_ids:[c2.id]}]});
 assert.throws(()=>L.begin({goal_id:g,kind:'LEARN',mode:'CLOSED_BOOK',requirement_ids:[supporting],request_id:id()}),/尚未裁决/);
 assert.ok(L.begin({goal_id:g,kind:'LEARN',mode:'CLOSED_BOOK',requirement_ids:[reqs[0]],request_id:id()}).assessment_id);
 assert.throws(()=>L.endGoal({id:g,status:'COMPLETED'}),/最终综合面试/);
});

test('resolved decisions are immutable after goal end',t=>{
 const {L,g,reqs,c1,c2}=fixture(t),[requirement]=reqs;
 L.materialMap.register({goal_id:g,content_id:c1.id,coverage:[],conflicts:[{description:'两份正文说法不同',requirement_ids:[requirement],important:true,source_content_ids:[c2.id]}]});
 const conflict=L.state(g).material_map.conflicts[0];L.endGoal({id:g,status:'ABANDONED'});
 assert.throws(()=>L.materialMap.resolve({goal_id:g,conflict_id:conflict.id,decision:'ADOPTED',source_content_id:c1.id,note:'选择现行版',request_id:id()}),/已结束目标只读/);
 assert.equal(L.materialMap.state(g).conflicts[0].status,'OPEN');
});

test('body and capability revisions preserve old judgments as stale and never carry their decisions forward',t=>{
 const {s,L,g,reqs,primary,other,c1,c2,cap}=fixture(t),[req]=reqs;
 L.materialMap.register({goal_id:g,content_id:c1.id,coverage:[],conflicts:[{description:'版本表述矛盾',requirement_ids:[req],important:true,source_content_ids:[c2.id]}]});
 L.materialMap.resolve({goal_id:g,conflict_id:L.state(g).material_map.conflicts[0].id,decision:'ADOPTED',source_content_id:c1.id,note:'本目标采用规范正文',request_id:id()});
 assert.equal(L.materialMap.blockers(g,[req]).length,0);
 s.db.prepare('UPDATE goal_resources SET scope=?,updated_at=? WHERE goal_id=? AND resource_id=?').run('关键章节',new Date().toISOString(),g,primary);
 assert.equal(L.state(g).material_map.conflicts[0].current,false,'资料适用范围变化后必须重新核对');
 L.material({goal_id:g,resource_id:other,scope:'全篇',content:'补充正文版本二'});
 assert.equal(L.state(g).material_map.conflicts[0].current,false);
 const next=L.material({goal_id:g,resource_id:primary,scope:'全篇',content:'规范正文版本二'}),state=L.state(g).material_map;
 assert.equal(state.conflicts[0].current,false);assert.equal(state.conflicts[0].status,'RESOLVED');assert.deepEqual(state.unmapped,reqs);
 assert.equal(L.materialMap.blockers(g,[req]).length,0);
 const ref=s.resource({goal_id:g,title:'参考背景',role:'REFERENCE',scope:'背景'}).id,refContent=L.material({goal_id:g,resource_id:ref,scope:'背景',content:'仅供参考'});
 assert.throws(()=>L.materialMap.register({goal_id:g,content_id:refContent.id,coverage:[{requirement_id:req,coverage:'COVERED'}],conflicts:[]}),/参考资料/);
 cap([{title:'新版要求',kind:'CORE',requirements:[{node:'握手',description:'解释新的握手语义'}]}]);
 assert.equal(L.state(g).material_map.conflicts[0].current,false);assert.equal(L.materialMap.blockers(g,L.state(g).requirements.map(r=>r.id)).length,0);
 assert.throws(()=>L.materialMap.resolve({goal_id:g,conflict_id:state.conflicts[0].id,decision:'ADOPTED',source_content_id:c1.id,note:'采用',request_id:id()}),/当前资料\/要求版本/);
 assert.notEqual(next.id,c1.id);assert.ok(other);
});

test('a shared resource gaining a different chapter in another goal keeps the first goal map current',t=>{
 const {s,L,g,reqs,primary,c1,c2}=fixture(t),[req]=reqs;
 const map=L.materialMap.register({goal_id:g,content_id:c1.id,coverage:[{requirement_id:req,coverage:'PARTIAL',rationale:'基线章节覆盖'}],conflicts:[{description:'A目标两份正文的定义不同',requirement_ids:[req],important:true,source_content_ids:[c2.id]}]});
 const second=s.createGoal({title:'另一目标',domain:'计算机'}).goal.id;
 s.goalResources.add({goal_id:second,resource_id:primary,role:'PRIMARY',scope:'另一目标的章节'});
 const cap=L.proposeCapabilities({goal_id:second,items:[{title:'章节要求',kind:'CORE',requirements:[{node:'章节',description:'解释章节内容'}]}],request_id:id()});L.confirmCapabilities({id:cap.proposal_id,accept:true});
 const secondContent=L.material({goal_id:second,resource_id:primary,scope:'另一目标的章节',content:'只属于另一目标的新章节'});
 const secondRequirement=L.state(second).requirements[0].id;
 assert.throws(()=>L.materialMap.register({goal_id:second,content_id:c1.id,coverage:[],conflicts:[]}),/正文版本不属于当前目标/);
 assert.ok(L.materialMap.register({goal_id:second,content_id:secondContent.id,coverage:[{requirement_id:secondRequirement,coverage:'COVERED'}],conflicts:[]}).map_id);
 const state=L.materialMap.state(g);
 assert.equal(state.items[0].current,true);
 assert.equal(state.conflicts.find(x=>x.map_id===map.map_id).current,true);
 assert.equal(L.materialMap.blockers(g,[req]).length,1);
});

test('re-registering an unchanged map is idempotent but new coverage or a new conflict is appended',t=>{
 const {L,g,reqs,c1,c2}=fixture(t),[req]=reqs;
 const base={goal_id:g,content_id:c1.id,coverage:[{requirement_id:req,coverage:'PARTIAL',rationale:'首轮判断'}],conflicts:[]};
 const first=L.materialMap.register(base);
 assert.equal(L.materialMap.register(base).reused,true);
 const conflict={description:'后来比对发现两份正文的含义相反',requirement_ids:[req],important:true,source_content_ids:[c2.id]};
 const second=L.materialMap.register({...base,coverage:[{requirement_id:req,coverage:'COVERED',rationale:'复核后正文直接覆盖'}],conflicts:[conflict]});
 assert.equal(second.map_id,first.map_id);assert.equal(second.revised,true);
 assert.equal(L.materialMap.register({...base,coverage:[{requirement_id:req,coverage:'COVERED',rationale:'复核后正文直接覆盖'}],conflicts:[conflict]}).reused,true);
 const state=L.materialMap.state(g);
 assert.equal(state.items[0].coverage,'COVERED');assert.equal(state.items[0].revision_history.length,2);
 assert.equal(state.conflicts.length,1);assert.equal(state.conflicts[0].status,'OPEN');
 assert.equal(L.materialMap.blockers(g,[req]).length,1);
});

test('map tool is exposed only to material and roadmap routes, and its write needs the live task lease plus read receipts',t=>{
 const {s,L,g,reqs,c1,c2}=fixture(t),[r]=reqs;
 assert.ok(moduleTools.material.includes('teacher_record_material_map'));assert.ok(moduleTools.roadmap.includes('teacher_record_material_map'));
 for(const role of ['chat','capabilities','assessment','review','final'])assert.ok(!moduleTools[role].includes('teacher_record_material_map'));
 const conversation=s.newConversation(g,'材料映射任务'),sent=s.send(conversation.id,'核对正文',id()),jobRow=s.db.prepare('SELECT id FROM jobs WHERE message_id=?').get(sent.message_id);
 s.models.tag(jobRow.id,'roadmap',null);s.db.prepare("UPDATE job_execution SET mode='API' WHERE job_id=?").run(jobRow.id);const job=s.claim('test',conversation.id,'API').job;
 assert.throws(()=>L.materialMap.registerFromJob({job_id:job.id,lease_token:'wrong',content_id:c1.id,coverage:[],conflicts:[]}),/有效的材料或路线任务/);
 assert.throws(()=>L.materialMap.registerFromJob({job_id:job.id,lease_token:job.lease_token,content_id:c1.id,coverage:[],conflicts:[]}),/先读取/);
 L.materialMap.recordReadFromJob({job_id:job.id,lease_token:job.lease_token,content_id:c1.id});
 L.materialMap.recordReadFromJob({job_id:job.id,lease_token:job.lease_token,content_id:c2.id});
 assert.ok(L.materialMap.registerFromJob({job_id:job.id,lease_token:job.lease_token,content_id:c1.id,coverage:[{requirement_id:r,coverage:'UNCLEAR'}],conflicts:[{description:'两份正文待核对',requirement_ids:[r],important:true,source_content_ids:[c2.id]}]}).map_id);
});

test('task-scoped roadmap reads register a map visible in goal progress; authenticated user can revise it',async t=>{
 const dataDir=mkdtempSync(join(tmpdir(),'teacher-map-')),app=startServer({port:0,dataDir});t.after(async()=>{await app.close();rmSync(dataDir,{recursive:true,force:true});});
 await new Promise(resolve=>app.server.listening?resolve():app.server.once('listening',resolve));
 const {s,L,g,reqs,c1,c2}=populate(app.store),[r]=reqs,conversation=s.newConversation(g,'比较两份资料');
 const sent=s.send(conversation.id,'请登记覆盖与关键冲突',id()),jobRow=s.db.prepare('SELECT id FROM jobs WHERE message_id=?').get(sent.message_id);
 s.models.tag(jobRow.id,'roadmap',null);s.db.prepare("UPDATE job_execution SET mode='MCP',agent_role='roadmap' WHERE job_id=?").run(jobRow.id);
 const job=s.claim('roadmap MCP',conversation.id,'MCP','roadmap').job;
 for(const content_id of [c1.id,c2.id])agentInvoke(s,'roadmap','teacher_read_material',{job_id:job.id,lease_token:job.lease_token,content_id});
 const saved=agentInvoke(s,'roadmap','teacher_record_material_map',{job_id:job.id,lease_token:job.lease_token,content_id:c1.id,coverage:[{requirement_id:r,coverage:'PARTIAL',rationale:'正文解释流程但没有覆盖异常路径'}],conflicts:[{description:'两份正文对重试次数的约束冲突',requirement_ids:[r],important:true,source_content_ids:[c2.id]}]});
 assert.ok(saved.map_id);
 const base='http://127.0.0.1:'+app.server.address().port,cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0];
 assert.equal((await fetch(base+'/api/material-map/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({goal_id:g,conflict_id:saved.map_id,decision:'DISMISSED'})})).status,401);
 let state=await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();
 const conflict=state.learning.material_map.by_goal[g].conflicts[0];assert.deepEqual(conflict.source_content_ids,[c1.id,c2.id]);
 const html=journeyView(state,g);assert.match(html,/资料覆盖与冲突/);assert.match(html,/采用「规范正文」/);assert.match(html,/重试次数/);
 assert.equal((await fetch(base+'/api/material-map/resolve',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({goal_id:g,conflict_id:conflict.id,decision:'ADOPTED',source_content_id:c1.id,note:'以规范正文的现行限制为准',request_id:id()})})).status,200);
 state=await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();const updated=state.learning.material_map.by_goal[g].conflicts[0];assert.equal(updated.status,'RESOLVED');assert.equal(updated.decision,'ADOPTED');assert.equal(updated.resolution_content_id,c1.id);assert.equal(updated.decision_history.length,1);assert.match(journeyView(state,g),/已采用：规范正文/);assert.doesNotMatch(journeyView(state,g),/当前状态：待裁决/);
});

test('Codex route catalog exposes material mapping only for roadmap jobs and binds each read',async t=>{
 const s=createStore(':memory:'),dataDir=mkdtempSync(join(tmpdir(),'teacher-map-codex-'));populate(s);let x,done=false;
 const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>child.emit('close',1);child.stdin.on('finish',()=>setImmediate(()=>{try{const invoke=(name,arguments_={})=>x.invoke({name,arguments:arguments_,operation_id:id()});assert.ok(x.catalog().tools.some(tool=>tool.name==='teacher_record_material_map'));const context=invoke('teacher_get_context');const [one,two]=context.learning.material_contents;invoke('teacher_read_material',{content_id:one.id});invoke('teacher_read_material',{content_id:two.id});invoke('teacher_record_material_map',{content_id:one.id,coverage:[],conflicts:[{description:'Codex 对比冲突',requirement_ids:[context.learning.requirements[0].id],important:true,source_content_ids:[two.id]}]});invoke('teacher_reply',{content:'已完成资料覆盖和冲突记录。'});done=true;}catch(error){child.emit('error',error);}finally{child.emit('close',0);}}));return child;};
 x=codexHost(s,{dataDir,baseUrl:()=>'',spawnProcess,intervalMs:1000000});t.after(async()=>{await x.stop();s.db.close();rmSync(dataDir,{recursive:true,force:true});});s.hostConfig.save({enabled:true});
 const conv=s.newConversation(s.overview().goals[0].id,'Codex 对照任务'),sent=s.send(conv.id,'请核对材料',id()),job=s.db.prepare('SELECT id FROM jobs WHERE message_id=?').get(sent.message_id);s.models.tag(job.id,'roadmap',null);await x.tick();
 assert.equal(done,true);assert.equal(s.learning.materialMap.state(s.overview().goals[0].id).conflicts.length,1);
});
