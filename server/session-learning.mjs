import {randomUUID} from 'node:crypto';
import {sessionLearningPrompt} from './agent-policy.mjs';

const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
export function sessionLearningService(db,{receipt,rollingPlan,resources}){
 db.exec(`CREATE TABLE IF NOT EXISTS session_chats(
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id),
  created_at TEXT NOT NULL
 )`);
 const one=(q,...p)=>db.prepare(q).get(...p),all=(q,...p)=>db.prepare(q).all(...p);
 function session(id){const s=one('SELECT * FROM sessions WHERE id=?',id);if(!s)fail('学习任务不存在',404);return s;}
 function assertExecutable(id){
  const s=session(id),goal=one('SELECT * FROM goals WHERE id=?',s.goal_id);
  if(goal?.status!=='ACTIVE')fail('请先确认路线并激活目标；暂停或结束的学习记录只读');
  if(s.status==='ASSESSING')fail('该任务正在正式考察，学习记录只供回看');
  if(s.status==='COMPLETED')fail('该任务已完成，学习记录只供回看');
  if(s.status==='REMOVED_FROM_PLAN')fail('该任务已从路线移除，学习记录只供回看');
  if(s.status!=='PLANNED')fail('该任务当前不可学习，学习记录只供回看');
  const proposal=one("SELECT * FROM proposals WHERE id=? AND goal_id=? AND status='ACCEPTED'",s.proposal_id,s.goal_id);
  if(!proposal)fail('请先确认当前目标的学习路线');
  if(!rollingPlan.isScheduleEligible(s.id))fail('该任务已延后、移除或暂不可执行，请在学习路线中恢复或处理');
  rollingPlan.assertExecutable(s.id);return s;
 }
 function open(input){return receipt(input.request_id,'session-learning:'+input.session_id,()=>{
  const s=session(input.session_id),existing=one('SELECT * FROM session_chats WHERE session_id=?',s.id);
  if(existing){const chat=one('SELECT * FROM conversations WHERE id=?',existing.conversation_id);if(chat?.kind!=='SESSION_LEARNING'||chat.goal_id!==s.goal_id)fail('学习任务不属于当前目标');return {conversation_id:existing.conversation_id};}
  assertExecutable(s.id);
  const c=randomUUID(),at=new Date().toISOString();
  db.prepare('INSERT INTO conversations VALUES(?,?,?,?,?)').run(c,s.goal_id,('任务学习 · '+s.title).slice(0,150),'SESSION_LEARNING',at);
  db.prepare('INSERT INTO session_chats VALUES(?,?,?)').run(s.id,c,at);
  return {conversation_id:c};
 });}
 function binding(c){return one('SELECT * FROM session_chats WHERE conversation_id=?',c);}
 function assertConversation(c){const b=binding(c),chat=one('SELECT * FROM conversations WHERE id=?',c);if(!b||!chat||chat.kind!=='SESSION_LEARNING')fail('任务学习记录缺少来源任务');const s=assertExecutable(b.session_id);if(chat.goal_id!==s.goal_id)fail('学习任务不属于当前目标');return s;}
 function planningOrigin(s){
  const exact=one(`SELECT c.* FROM planning_flow_outputs o JOIN jobs j ON j.id=o.job_id JOIN conversations c ON c.id=j.conversation_id
   WHERE o.artifact_id=? AND o.goal_id=? AND o.tool_name='teacher_plan_learning' AND c.goal_id=? AND c.kind='PLANNING' ORDER BY o.rowid DESC LIMIT 1`,s.proposal_id,s.goal_id,s.goal_id);
  if(exact)return {conversation:exact,source:'ROUTE_OUTPUT'};
  const anchor=one("SELECT c.* FROM planning_flows f JOIN conversations c ON c.id=f.conversation_id WHERE f.goal_id=? AND c.goal_id=? AND c.kind='PLANNING'",s.goal_id,s.goal_id);
  if(anchor)return {conversation:anchor,source:'GOAL_FLOW_FALLBACK'};
  return {conversation:one("SELECT * FROM conversations WHERE goal_id=? AND kind='PLANNING' ORDER BY rowid LIMIT 1",s.goal_id)||null,source:'LEGACY_GOAL_FALLBACK'};
 }
 function context(c){
  const b=binding(c);if(!b)fail('任务学习记录缺少来源任务');
  const s=session(b.session_id),raw=one('SELECT * FROM session_details WHERE session_id=?',s.id);
  const details=raw?{...raw,requirements:JSON.parse(raw.requirements),resources:JSON.parse(raw.resources),dependencies:JSON.parse(raw.dependencies)}:null;
  const proposal=one('SELECT items FROM proposals WHERE id=? AND goal_id=?',s.proposal_id,s.goal_id);
  const item=proposal?JSON.parse(proposal.items)[s.position]:null;
  const requirements=details?.requirements||item?.requirement_ids||[];
  const capabilities=all('SELECT r.*,n.name AS node_name FROM requirements r JOIN knowledge_nodes n ON n.id=r.node_id WHERE r.goal_id=?',s.goal_id).filter(r=>requirements.includes(r.id));
  const resourceIds=new Set(details?.resources||item?.resource_ids||[]);
  const linked=resources(s.goal_id).filter(r=>resourceIds.has(r.id));
  let remaining=40000;
  const materials=linked.flatMap(r=>{
   if(r.scope_status!=='CONFIRMED'||!r.content_id)return [];
   const content=one('SELECT id AS content_id,resource_id,scope,hash,content FROM material_contents WHERE id=? AND resource_id=? AND scope=?',r.content_id,r.id,r.target_scope);
   if(!content)return [];
   const excerpt=content.content.slice(0,Math.min(12000,remaining));remaining-=excerpt.length;
   return [{...content,title:r.title,content:excerpt,characters:content.content.length,truncated:excerpt.length<content.content.length}];
  });
  const origin=planningOrigin(s),planning=origin.conversation;
  let unavailable_reason='';try{assertConversation(c);}catch(e){unavailable_reason=e.message;}
  return {session:s,details,capabilities,resources:linked,materials,planning_origin:origin.source,planning_conversation:planning?{...planning,messages:all('SELECT * FROM messages WHERE conversation_id=? ORDER BY rowid',planning.id)}:null,read_only:!!unavailable_reason,unavailable_reason,instructions:sessionLearningPrompt};
 }
 function list(){return all('SELECT * FROM session_chats ORDER BY created_at').map(row=>{let unavailable_reason='';try{assertConversation(row.conversation_id);}catch(e){unavailable_reason=e.message;}const origin=planningOrigin(session(row.session_id));return {...row,planning_conversation_id:origin.conversation?.id||null,planning_origin:origin.source,read_only:!!unavailable_reason,unavailable_reason};});}
 return {open,context,assertConversation,binding,list};
}
