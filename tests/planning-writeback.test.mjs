import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore,id} from '../server/store.mjs';
import {invoke} from '../server/tools.mjs';

test('manual planning specialist must read the exact bound body on its own job before committing the analysis',async t=>{
 const s=createStore(':memory:');t.after(()=>s.db.close());
 const {goal,conversation}=s.createGoal({title:'材料来源核对',domain:'测试'});
 const r=s.resource({goal_id:goal.id,title:'原始说明',role:'PRIMARY',scope:'第一章'});
 const content=s.learning.material({goal_id:goal.id,resource_id:r.id,scope:'第一章',content:'第一章正文'});
 s.send(conversation.id,'先学第一章，重点核对材料出处。',id());
 const ordinary=s.claim('manual-host',conversation.id).job;s.reply({job_id:ordinary.id,lease_token:ordinary.lease_token,request_id:id(),content:'先从第一章开始。'});
 s.planningFlow.start({goal_id:goal.id,conversation_id:conversation.id,request_id:id()});
 const {job}=s.claim('manual-host',conversation.id);assert.equal(s.models.state().tasks.find(row=>row.job_id===job.id).module,'material');
 const binding={job_id:job.id,lease_token:job.lease_token},analysis={content_id:content.id,summary:'可用说明',status:'ANALYZED',request_id:id()};
 await assert.rejects(invoke(s,'teacher_analyze_material',analysis),/领取信息/);
 await assert.rejects(invoke(s,'teacher_analyze_material',{...analysis,...binding}),/先.*读/);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM material_analysis').get().n,0);
 await invoke(s,'teacher_read_material',{...binding,content_id:content.id});
 await invoke(s,'teacher_analyze_material',{...analysis,...binding});
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM material_analysis').get().n,1);
});
