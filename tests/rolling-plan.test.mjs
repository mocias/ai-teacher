import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildRollingQueue} from '../server/rolling-plan.mjs';
import {createStore} from '../server/store.mjs';

function fixture(){
 const goals=[{id:'g1',domain:'AI',status:'ACTIVE'},{id:'g2',domain:'Math',status:'ACTIVE'},{id:'paused',domain:'AI',status:'PAUSED'}];
 const sessions=[];
 const add=(id,goal_id='g1',proposal_id='p',position=sessions.length,status='PLANNED')=>sessions.push({id,goal_id,proposal_id,position,status,title:id});
 add('a');add('b');add('c');add('d');add('cross','g2','p2',0);add('paused-one','paused','p3',0);add('done','g1','p',7,'COMPLETED');
 const proposals=[{id:'p',status:'ACCEPTED',items:Array.from({length:8},()=>({key:'topic',topic:'主题',requirement_ids:['core'],dependencies:[]}))},{id:'p2',status:'ACCEPTED',items:[{key:'math',topic:'数学',requirement_ids:[],dependencies:[]}]},{id:'p3',status:'ACCEPTED',items:[{key:'paused',dependencies:[]}]}];
 return {goals,sessions,details:[],proposals};
}

test('N=3 is a global cap across active goals; stable goal priority and legacy tasks are retained',()=>{
 const f=fixture(),result=buildRollingQueue({...f,settings:{global_limit:3,goal_order:['g2','g1']}});
 assert.equal(result.queue.length,3);assert.deepEqual(result.queue.map(x=>x.session.id),['cross','a','b']);
 assert.ok(result.excluded.some(x=>x.session.id==='paused-one'&&x.reason==='目标已暂停'));
 const legacy={id:'legacy',goal_id:'g2',proposal_id:null,position:1,status:'PLANNED',title:'旧任务'};f.sessions.push(legacy);
 assert.ok(buildRollingQueue({...f,settings:{global_limit:10}}).queue.some(x=>x.session.id==='legacy'));
});

test('deferred and blocked items do not consume N and N is backfilled from executable work',()=>{
 const f=fixture(),result=buildRollingQueue({...f,settings:{global_limit:3},deferred:['a'],blockers:(goal,ids)=>ids.includes('core')?[{description:'待裁决冲突'}]:[]});
 assert.deepEqual(result.queue.map(x=>x.session.id),['cross']);
 assert.ok(result.excluded.some(x=>x.session.id==='a'&&x.reason==='你已延后此任务'));
 assert.ok(result.excluded.some(x=>x.session.id==='b'&&x.reason.includes('待裁决冲突')));
 assert.equal(result.available_count,1);
});

test('explicit topic prerequisites gate tasks; completed prerequisite unlocks the dependent topic',()=>{
 const f={goals:[{id:'g',status:'ACTIVE'}],sessions:[{id:'pre',goal_id:'g',proposal_id:'p',position:0,status:'PLANNED'},{id:'next',goal_id:'g',proposal_id:'p',position:1,status:'PLANNED'}],proposals:[{id:'p',status:'ACCEPTED',items:[{key:'foundation',dependencies:[]},{key:'advanced',dependencies:['foundation']}]}]};
 let result=buildRollingQueue({...f,settings:{global_limit:5}});assert.ok(result.excluded.some(x=>x.session.id==='next'&&x.reason.includes('foundation')));
 f.sessions[0].status='COMPLETED';result=buildRollingQueue({...f,settings:{global_limit:5}});assert.ok(result.queue.some(x=>x.session.id==='next'));
});

test('empty or undersized queues stay empty and completed work is not presented as blocked',()=>{
 const f=fixture();f.sessions=f.sessions.filter(x=>x.id==='done');const result=buildRollingQueue({...f,settings:{global_limit:3}});assert.equal(result.queue.length,0);assert.equal(result.available_count,0);assert.equal(result.excluded.length,1);
 const noGoals=buildRollingQueue({goals:[],sessions:[],settings:{global_limit:3}});assert.deepEqual(noGoals.queue,[]);assert.equal(noGoals.available_count,0);
});

test('removing one session does not exclude its topic; excluding a core topic is identifiable for completion guard',()=>{
 const f=fixture(),removed=['a'],excludedTopics=[{proposal_id:'p',topic_key:'topic'}];
 const result=buildRollingQueue({...f,settings:{global_limit:10},removed,excludedTopics});
 assert.ok(result.excluded.some(x=>x.session.id==='a'&&x.reason==='你已移除此单个任务'));
 assert.ok(result.excluded.some(x=>x.session.id==='b'&&x.reason==='你已排除此主题'));
 assert.ok(result.excluded.some(x=>x.session.id==='c'&&x.reason==='你已排除此主题'));
});

test('queue settings use revision checks and reject stale concurrent writes',t=>{
 const store=createStore(':memory:');t.after(()=>store.db.close());const api=store.rollingPlan,first=api.configuration();
 const changed=api.configure({revision:first.revision,global_limit:4,domain_limits:{AI:2},goal_order:[]});assert.equal(changed.revision,first.revision+1);assert.equal(changed.global_limit,4);
 assert.throws(()=>api.configure({revision:first.revision,global_limit:5,domain_limits:{},goal_order:[]}),/已被其他操作更新/);
});

test('deferral prevents new study and calendar scheduling while an existing calendar entry remains editable',t=>{
 const store=createStore(':memory:');t.after(()=>store.db.close());const db=store.db;
 db.prepare('INSERT INTO goals VALUES(?,?,?,?,?,?)').run('g','Goal','AI','Scope','ACTIVE','2026-01-01');
 db.prepare('INSERT INTO proposals VALUES(?,?,?,?,?,?,?)').run('p','g','Route','Summary','[{"title":"Task"}]','ACCEPTED','2026-01-01');
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?)').run('s','g','p','Task','Objective','PLANNED',0,null);
 const entry=store.calendar.save({session_id:'s',title:'Task',date:'2026-11-03'});
 store.rollingPlan.defer({session_id:'s',reason:'先处理别的'});
 assert.throws(()=>store.startSession('s'),/延后/);
 assert.equal(store.rollingPlan.isScheduleEligible('s'),false);
 const blank=store.calendar.save({title:'独立日程',date:'2026-11-05'});
 assert.throws(()=>store.calendar.save({id:blank.id,session_id:'s',title:'改绑到延后任务',date:'2026-11-05'}),/延后/);
 assert.doesNotThrow(()=>store.calendar.save({id:entry.id,session_id:'s',title:'Task moved',date:'2026-11-04'}));
});

test('excluding a topic containing a core requirement blocks final completion; removing one session does not',t=>{
 const store=createStore(':memory:');t.after(()=>store.db.close());const db=store.db;
 db.prepare('INSERT INTO goals VALUES(?,?,?,?,?,?)').run('g','Goal','AI','Scope','ACTIVE','2026-01-01');
 db.prepare('INSERT INTO capability_sets VALUES(?,?,?,?,?)').run('set','g','[]','ACCEPTED','2026-01-01');
 db.prepare('INSERT INTO readiness_items VALUES(?,?,?,?,?)').run('core-item','g','set','Core','CORE');
 db.prepare('INSERT INTO knowledge_nodes VALUES(?,?,?)').run('node','Knowledge','AI');
 db.prepare('INSERT INTO requirements VALUES(?,?,?,?,?,?)').run('req','g','set','core-item','node','Explain core');
 db.prepare('INSERT INTO proposals VALUES(?,?,?,?,?,?,?)').run('p','g','Route','Summary','[{"key":"topic","topic":"Core topic","requirement_ids":["req"]}]','ACCEPTED','2026-01-01');
 db.prepare('INSERT INTO roadmap_details VALUES(?,?,?)').run('p','set','{}');
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?)').run('s','g','p','Only task','Objective','PLANNED',0,null);
 assert.equal(store.rollingPlan.removeSession({session_id:'s'}).excluded.some(x=>x.session.id==='s'),true);
 assert.doesNotThrow(()=>store.rollingPlan.assertNoCoreTopicExclusion('g'));
 const result=store.rollingPlan.excludeTopic({proposal_id:'p',topic_key:'topic'});assert.equal(result.blocks_completion,true);
 assert.throws(()=>store.rollingPlan.assertNoCoreTopicExclusion('g'),/必要核心主题/);
 assert.throws(()=>store.learning.endGoal({id:'g',status:'COMPLETED'}),/必要核心主题/);
});

test('core-topic completion guard follows the latest capability set and route, not prior exclusions',t=>{
 const store=createStore(':memory:');t.after(()=>store.db.close());const db=store.db;
 db.prepare('INSERT INTO goals VALUES(?,?,?,?,?,?)').run('g','Goal','AI','Scope','ACTIVE','2026-01-01');
 db.prepare('INSERT INTO capability_sets VALUES(?,?,?,?,?)').run('setA','g','[]','ACCEPTED','2026-01-01');
 db.prepare('INSERT INTO readiness_items VALUES(?,?,?,?,?)').run('itemA','g','setA','Core A','CORE');
 db.prepare('INSERT INTO knowledge_nodes VALUES(?,?,?)').run('nodeA','A','AI');
 db.prepare('INSERT INTO requirements VALUES(?,?,?,?,?,?)').run('reqA','g','setA','itemA','nodeA','A');
 db.prepare('INSERT INTO proposals VALUES(?,?,?,?,?,?,?)').run('pA','g','Route A','Summary','[{"key":"topicA","requirement_ids":["reqA"]}]','ACCEPTED','2026-01-01');
 db.prepare('INSERT INTO roadmap_details VALUES(?,?,?)').run('pA','setA','{}');
 assert.equal(store.rollingPlan.excludeTopic({proposal_id:'pA',topic_key:'topicA'}).blocks_completion,true);

 db.prepare('UPDATE capability_sets SET status=\'SUPERSEDED\' WHERE id=\'setA\'').run();
 db.prepare('INSERT INTO capability_sets VALUES(?,?,?,?,?)').run('setB','g','[]','ACCEPTED','2026-01-02');
 db.prepare('INSERT INTO readiness_items VALUES(?,?,?,?,?)').run('itemB','g','setB','Core B','CORE');
 db.prepare('INSERT INTO knowledge_nodes VALUES(?,?,?)').run('nodeB','B','AI');
 db.prepare('INSERT INTO requirements VALUES(?,?,?,?,?,?)').run('reqB','g','setB','itemB','nodeB','B');
 db.prepare('INSERT INTO proposals VALUES(?,?,?,?,?,?,?)').run('pB','g','Route B','Summary','[{"key":"topicB","requirement_ids":["reqB"]}]','ACCEPTED','2026-01-02');
 db.prepare('INSERT INTO roadmap_details VALUES(?,?,?)').run('pB','setB','{}');
 assert.doesNotThrow(()=>store.rollingPlan.assertNoCoreTopicExclusion('g'));
 assert.equal(store.rollingPlan.excludeTopic({proposal_id:'pB',topic_key:'topicB'}).blocks_completion,true);
 assert.throws(()=>store.rollingPlan.assertNoCoreTopicExclusion('g'),/必要核心主题/);
});
