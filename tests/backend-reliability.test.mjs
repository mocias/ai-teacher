import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore,id} from '../server/store.mjs';
import {modelExecutor} from '../server/model-executor.mjs';

const response=()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'仅在明确重试后完成'}}]}),{headers:{'Content-Type':'application/json'}});
const memory=t=>{const s=createStore(':memory:');t.after(()=>s.db.close());return s;};

test('material task uses confirmed per-goal body binding, including shared resources',t=>{
 const s=memory(t),a=s.createGoal({title:'来源目标',domain:'测试'}),b=s.createGoal({title:'共享目标',domain:'测试'});
 const r=s.resource({goal_id:a.goal.id,title:'共享材料',role:'PRIMARY'});
 const first=s.learning.material({resource_id:r.id,scope:'第一章',content:'第一章正文'});
 s.attachResource({request_id:id(),goal_id:b.goal.id,resource_id:r.id,role:'PRIMARY',scope:'第一章',content_id:first.id});
 assert.doesNotThrow(()=>s.models.validateTask(b.conversation.id,'material',first.id));
 const next=s.learning.material({resource_id:r.id,goal_id:a.goal.id,scope:'第二章',content:'第二章正文'});
 assert.throws(()=>s.models.validateTask(b.conversation.id,'material',next.id),/当前目标/);
 assert.throws(()=>s.models.validateTask(a.conversation.id,'material',first.id),/当前目标/);
 assert.doesNotThrow(()=>s.models.validateTask(a.conversation.id,'material',next.id));
 s.goalResources.confirmScope(b.goal.id,r.id,'第三章');
 assert.throws(()=>s.models.validateTask(b.conversation.id,'material',first.id),/当前目标/);
});

test('expired automated lease blocks a late response and cannot repeat before explicit retry',async t=>{
 const s=createStore(':memory:');let release,started,calls=0;const ready=new Promise(r=>started=r);
 const x=modelExecutor(s,{intervalMs:1000000,fetcher:async()=>{calls++;if(calls===1){started();return new Promise(r=>release=()=>r(response()));}return response();}});
 t.after(async()=>{await x.stop();s.db.close();});
 const g=s.createGoal({title:'超时恢复',domain:'测试'}),p=s.models.save({name:'本地模拟',base_url:'https://test.invalid/v1',model:'test',options:{}});
 s.models.routes({routes:[{module:'chat',profile_id:p.id}]});s.models.enabled(true);
 const {job_id:jid}=s.send(g.conversation.id,'等待后恢复',id());s.models.tag(jid);
 const work=x.tick();await ready;
 s.db.prepare('UPDATE jobs SET lease_until=? WHERE id=?').run(Date.now()-1,jid);s.recover();release();await work;
 assert.equal(s.db.prepare('SELECT blocked FROM job_execution WHERE job_id=?').get(jid).blocked,1);
 await x.tick();assert.equal(calls,1);assert.equal(s.messages(g.conversation.id).length,1);
 s.models.reroute({job_id:jid,mode:'API'});await x.tick();assert.equal(calls,2);assert.equal(s.messages(g.conversation.id).length,2);
});

test('manual leases remain reclaimable while expired automatic host jobs are blocked',t=>{
 const s=memory(t),g=s.createGoal({title:'手动恢复',domain:'测试'});
 const manual=s.send(g.conversation.id,'手动消息',id());const first=s.claim('Manual',g.conversation.id).job;
 s.db.prepare('UPDATE jobs SET lease_until=0 WHERE id=?').run(first.id);s.recover();
 assert.equal(s.claim('Manual',g.conversation.id).job.id,manual.job_id);
 s.cancel(first.id);
 for(const type of ['host','harness']){
  const m=s.send(g.conversation.id,type,id()),job=s.claim('Automatic',g.conversation.id).job;
  if(type==='host')s.db.prepare("INSERT INTO host_runs(id,job_id,status,model,created_at) VALUES(?,?,'RUNNING','test',?)").run(id(),m.job_id,new Date().toISOString());
  else s.db.prepare("INSERT INTO harness_runs(id,job_id,role,harness,status,created_at) VALUES(?,?,'chat','DSH','RUNNING',?)").run(id(),m.job_id,new Date().toISOString());
  s.db.prepare('UPDATE jobs SET lease_until=0 WHERE id=?').run(job.id);s.recover();
  assert.equal(s.db.prepare('SELECT blocked FROM job_execution WHERE job_id=?').get(job.id).blocked,1);
  assert.equal(s.claim('Automatic',g.conversation.id).job,null);s.cancel(job.id);
 }
});

test('restart blocks an unfinished automatic run even if its lease was already released',async t=>{
 const s=createStore(':memory:');const g=s.createGoal({title:'中断恢复',domain:'测试'});
 const p=s.models.save({name:'测试',base_url:'https://test.invalid',model:'test',options:{}});
 const rows=[];
 for(const status of ['QUEUED','RUNNING','CANCELLED','COMPLETED']){
  const {job_id}=s.send(g.conversation.id,status,id());s.models.tag(job_id);
  s.db.prepare('UPDATE jobs SET status=? WHERE id=?').run(status,job_id);
  s.db.prepare("INSERT INTO model_runs(id,job_id,module,profile_id,provider_name,model,base_url,status,created_at) VALUES(?,?,'chat',?,'测试','test','https://test.invalid','RUNNING',?)").run(id(),job_id,p.id,new Date().toISOString());
  rows.push({status,job_id});
 }
 const executor=modelExecutor(s,{intervalMs:1000000,fetcher:()=>{throw Error('restart must not send');}});
 t.after(async()=>{await executor.stop();s.db.close();});
 for(const row of rows){
  const current=s.db.prepare('SELECT j.status,e.blocked FROM jobs j JOIN job_execution e ON e.job_id=j.id WHERE j.id=?').get(row.job_id);
  assert.equal(current.status,['QUEUED','RUNNING'].includes(row.status)?'QUEUED':row.status);
  assert.equal(current.blocked,['QUEUED','RUNNING'].includes(row.status)?1:0);
 }
});
