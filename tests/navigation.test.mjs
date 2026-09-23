import {test} from 'node:test';
import assert from 'node:assert/strict';
import {learningView,reviewView} from '../public/learning.js';

test('assessment and review pages separate records and retain review actions',()=>{
 const state={goals:[{id:'g',status:'ACTIVE'}],learning:{capability_sets:[],requirements:[{id:'r',description:'缓存原理'}],readiness_items:[],assessments:[{id:'a',goal_id:'g',kind:'INITIAL_DIAGNOSTIC',status:'COMPLETED',scope:'诊断范围'},{id:'b',goal_id:'g',kind:'REVIEW',status:'WAITING_ANSWER',scope:'复习范围',conversation_id:'c'}],gaps:[],reviews:[{id:'rev',goal_id:'g',requirement_id:'r',due_date:'2026-09-24',status:'DUE'}],readiness_judgments:[],goal_snapshots:[]}};
 const assessment=learningView(state,'g'),review=reviewView(state,'g');
 assert.match(assessment,/诊断范围/);assert.doesNotMatch(assessment,/复习范围|<h2>复习安排/);
 assert.match(review,/复习范围/);assert.doesNotMatch(review,/诊断范围|能力要求与达成判断/);
 assert.match(review,/缓存原理/);assert.match(review,/v2-start-review/);assert.match(review,/v2-reschedule/);assert.match(review,/v2-results/);
 assert.match(reviewView({goals:[]},null),/先创建一个学习目标/);
});
