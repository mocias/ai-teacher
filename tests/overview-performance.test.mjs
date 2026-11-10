import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../server/store.mjs';

function setup(t){const s=createStore(':memory:');t.after(()=>s.db.close());return s;}
function content(s,resourceId,scope,id){
 s.db.prepare('INSERT INTO material_contents(id,resource_id,scope,content,hash,created_at) VALUES(?,?,?,?,?,?)').run(id,resourceId,scope,'body '+id,'hash-'+id,'2026-01-01');
}
function analysis(s,{id,goalId,resourceId,contentId,scope}){
 s.db.prepare('INSERT INTO material_analysis(id,resource_id,content_id,scope,summary,status,created_at,goal_id) VALUES(?,?,?,?,?,?,?,?)').run(id,resourceId,contentId,scope,'summary '+id,'DONE','2026-01-01',goalId);
}

test('global learning state bulk material fields preserve prior goal and row ordering semantics',t=>{
 const s=setup(t),g1=s.createGoal({title:'准备中',domain:'A'}).goal.id,g2=s.createGoal({title:'进行中',domain:'B'}).goal.id,g3=s.createGoal({title:'已结束',domain:'C'}).goal.id;
 s.db.prepare("UPDATE goals SET status='ACTIVE' WHERE id=?").run(g2);

 const shared=s.resource({title:'跨目标材料'}),sharedBody='shared-body';content(s,shared.id,'同一范围',sharedBody);
 s.goalResources.add({goal_id:g1,resource_id:shared.id,role:'PRIMARY',scope:'同一范围',content_id:sharedBody});
 s.goalResources.add({goal_id:g2,resource_id:shared.id,role:'REFERENCE',scope:'同一范围',content_id:sharedBody});
 analysis(s,{id:'a-shared-1',goalId:g1,resourceId:shared.id,contentId:sharedBody,scope:'同一范围'});
 analysis(s,{id:'a-shared-2',goalId:g2,resourceId:shared.id,contentId:sharedBody,scope:'同一范围'});

 const ranged=s.resource({title:'不同范围材料'}),rangeA='range-a',rangeB='range-b';content(s,ranged.id,rangeA,'ranged-a');content(s,ranged.id,rangeB,'ranged-b');
 s.goalResources.add({goal_id:g1,resource_id:ranged.id,role:'SUPPLEMENTARY',scope:rangeA,content_id:'ranged-a'});
 s.goalResources.add({goal_id:g3,resource_id:ranged.id,role:'PRIMARY',scope:rangeB,content_id:'ranged-b'});
 analysis(s,{id:'a-range-a',goalId:g1,resourceId:ranged.id,contentId:'ranged-a',scope:rangeA});
 analysis(s,{id:'a-range-b',goalId:g3,resourceId:ranged.id,contentId:'ranged-b',scope:rangeB});
 s.db.prepare("UPDATE goals SET status='COMPLETED' WHERE id=?").run(g3);

 const pending=s.resource({title:'范围待确认'});content(s,pending.id,'','pending-body');
 s.goalResources.add({goal_id:g2,resource_id:pending.id,role:'PRIMARY',scope:'',content_id:null});
 const unattached=s.resource({title:'未关联材料'});content(s,unattached.id,'unlinked','unlinked-body');
 analysis(s,{id:'a-unlinked',goalId:g2,resourceId:unattached.id,contentId:'unlinked-body',scope:'unlinked'});

 // Reconstruct the pre-optimization aggregation from the scoped readers.
 const goals=s.db.prepare('SELECT id FROM goals').all().map(row=>row.id);
 const expectedContents=goals.flatMap(goalId=>s.goalResources.contents(goalId));
 const noLinks=' AND NOT EXISTS(SELECT 1 FROM goal_resources gr WHERE gr.resource_id=material_contents.resource_id)';
 expectedContents.push(...s.db.prepare('SELECT id,resource_id,scope,hash,created_at,length(content) AS characters FROM material_contents WHERE 1=1'+noLinks).all());
 const expectedAnalysis=goals.flatMap(goalId=>s.goalResources.analyses(goalId));
 expectedAnalysis.push(...s.db.prepare('SELECT * FROM material_analysis WHERE resource_id IN (SELECT id FROM resources WHERE NOT EXISTS(SELECT 1 FROM goal_resources gr WHERE gr.resource_id=resources.id))').all());

 const global=s.learning.state();
 assert.deepEqual(global.material_contents,expectedContents);
 assert.deepEqual(global.material_analysis,expectedAnalysis);
 assert.deepEqual(s.learning.state(g1).material_contents,s.goalResources.contents(g1));
 assert.deepEqual(s.learning.state(g3).material_analysis,s.goalResources.analyses(g3));
 assert.equal(global.material_contents.filter(x=>x.resource_id===shared.id).length,2);
 assert.equal(global.material_contents.some(x=>x.id==='pending-body'),false);
 assert.equal(global.material_contents.some(x=>x.id==='unlinked-body'),true);
});
