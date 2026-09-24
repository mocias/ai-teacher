import {test} from 'node:test';
import assert from 'node:assert/strict';
import {roadmapModel,roadmapView} from '../public/roadmap.js';
import {detailContent} from '../public/details.js';
test('roadmap displays explicit topic DAG and groups tasks without inferred edges',()=>{
 const items=[{key:'a',topic:'基础',phase:'阶段一',dependencies:[]},{key:'a',topic:'基础',phase:'阶段一',dependencies:[]},{key:'b',topic:'应用',phase:'阶段二',dependencies:['a']},{key:'c',topic:'实验',phase:'阶段二',dependencies:['a']}];
 const state={sessions:items.map((x,i)=>({id:String(i),proposal_id:'p',position:i,goal_id:'g',title:'任务'+i,status:'PLANNED'})),proposals:[{id:'p',items}],learning:{session_details:[]}};
 const model=roadmapModel(state,'g');assert.equal(model.nodes.length,3);assert.equal(model.edges.length,2);assert.equal(model.nodes[0].sessions.length,2);assert.equal(model.nodes[1].rank,1);assert.match(roadmapView(state,'g'),/data-action="detail-session"/);
 state.sessions.push({id:'legacy',proposal_id:'old',position:0,goal_id:'g',title:'旧任务',status:'PLANNED'});assert.equal(roadmapModel(state,'g').edges.length,2);assert.match(roadmapView(state,'g'),/部分旧任务/);
 state.sessions.push({id:'other',proposal_id:'other',position:0,goal_id:'g',title:'同名键',status:'PLANNED'});state.proposals.push({id:'other',items:[{key:'a',dependencies:[]}]});assert.equal(roadmapModel(state,'g').edges.length,2);
});
test('read-only detail escapes text and shows full review and note contents',()=>{
 const state={notes:[{id:'n',title:'<script>',content:'完整笔记\n第二行',updated_at:'today'}],learning:{reviews:[{id:'r',requirement_id:'req',due_date:'2026-10-01',reason:'间隔回忆',status:'DUE'}],requirements:[{id:'req',description:'复用边界'}],gaps:[]}};
 assert.match(detailContent(state,'note','n').body,/完整笔记\n第二行/);assert.match(detailContent(state,'review','r').body,/复用边界/);assert.match(detailContent(state,'review','r').body,/v2-reschedule/);assert.equal(detailContent(state,'review','missing'),null);
});
