import {z} from 'zod';
import {tools} from './tools.mjs';
import {moduleTools,configurationTools,executionTools,guidePrompt} from './agent-policy.mjs';
import {limitStudyContext} from './study.mjs';
const fail=m=>{throw Object.assign(new Error(m),{status:403});};
const common=['teacher_claim_message','teacher_get_context','teacher_reply','teacher_renew_lease'];
const special=['teacher_propose_goal_draft','teacher_propose_profile','teacher_review_changes','teacher_record_reason'];
export function agentCatalog(role){
 const names=[...new Set([...common,...(role==='master'?configurationTools:role==='chat'?special:role==='onboarding'?['teacher_propose_profile']:role==='change_review'?['teacher_propose_profile','teacher_review_changes','teacher_record_reason']:moduleTools[role]||[])])];
 return names.map(name=>({name,description:tools[name].description,schema:name==='teacher_claim_message'?z.object({conversation_id:z.string().optional()}):tools[name].schema.omit({conversation_id:true,goal_id:true,assessment_id:true}).extend({job_id:z.string(),lease_token:z.string()})}));
}
export function agentInvoke(store,role,name,input){
 const def=agentCatalog(role).find(t=>t.name===name);if(!def)fail('此 Agent 不允许该工具');const a=def.schema.parse(input);
 if(name==='teacher_claim_message'){
  const claim=store.claim('Agent '+role,a.conversation_id,'MCP',role);
  if(claim.job){claim.context=jobContext(store,claim.job);claim.task=store.db.prepare('SELECT module,content_id,agent_role FROM job_execution WHERE job_id=?').get(claim.job.id);if(role==='master')claim.instructions=guidePrompt;}
  return claim;
 }
 const job=store.leased(a.job_id,a.lease_token);const goal=store.db.prepare('SELECT g.status FROM goals g JOIN conversations c ON c.goal_id=g.id WHERE c.id=?').get(job.conversation_id);if(['PAUSED','ABANDONED'].includes(goal?.status))fail('目标已暂停或结束');const task=store.db.prepare('SELECT * FROM job_execution WHERE job_id=?').get(job.id);
 if(task.agent_role!==role||task.mode!=='MCP')fail('任务不属于此 Agent');
 const context=jobContext(store,job);
 if(role==='master'&&!context.orchestration)fail('主 Agent 仅处理配置引导对话');
 if(name==='teacher_get_context')return context;
 if(name==='teacher_renew_lease')return store.renew(job.id,a.lease_token);
 if(name!=='teacher_reply'&&!executionTools(task,context).includes(name))fail('此任务不允许该工具');
 const as=context.learning.assessment;
 const values={...a,job_id:job.id,lease_token:job.lease_token,conversation_id:job.conversation_id,goal_id:context.goal?.id,assessment_id:as?.id,request_id:a.request_id?`${job.id}:${a.request_id.slice(0,60)}`:undefined};
 if(['teacher_read_material','teacher_analyze_material'].includes(name)){
  const allowed=task.content_id?[task.content_id]:as?as.material_refs.map(r=>r.content_id):context.learning.material_contents.map(r=>r.id);
  if(!allowed.includes(a.content_id))fail('资料不属于当前任务');
  if(name==='teacher_analyze_material'&&!store.db.prepare('SELECT 1 FROM receipts WHERE request_id=?').get(job.id+':read:'+a.content_id))fail('先读取材料正文再保存分析');
 }
 if(name==='teacher_assessment_feedback'&&!as?.rounds.some(r=>r.id===a.round_id))fail('题目不属于当前考察');
 if(name==='teacher_finish_assessment')for(const j of a.readiness||[])for(const id of j.evidence_ids||[])if(!store.db.prepare('SELECT id FROM evidence WHERE id=? AND goal_id=?').get(id,context.goal.id))fail('证据不属于当前目标');
 const result=tools[name].call(store,tools[name].schema.parse(values));
 if(name==='teacher_read_material')store.db.prepare('INSERT OR IGNORE INTO receipts VALUES(?,?,?)').run(job.id+':read:'+a.content_id,'agent-read','{}');
 return result;
}
function jobContext(store,job){const c=store.context(job.conversation_id),index=c.messages.findIndex(m=>m.id===job.message_id);c.messages=c.messages.slice(0,index+1);limitStudyContext(c);return {...c,claimed_message_id:job.message_id};}
