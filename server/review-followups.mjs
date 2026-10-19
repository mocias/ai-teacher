import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';

const fail=message=>{throw Object.assign(new Error(message),{status:409});};
export function reviewFollowups(db,file,{receipt}){
 const one=(sql,...args)=>db.prepare(sql).get(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 if(!one("SELECT name FROM sqlite_master WHERE name='review_sources'")){
  if(file!==':memory:'&&one('SELECT id FROM goals LIMIT 1')){
   const folder=join(dirname(file),'backups');mkdirSync(folder,{recursive:true});
   db.prepare('VACUUM INTO ?').run(join(folder,'before-review-followups-'+Date.now()+'.sqlite'));
  }
  db.exec('CREATE TABLE review_sources(review_id TEXT PRIMARY KEY REFERENCES reviews(id),assessment_id TEXT NOT NULL REFERENCES assessments(id),evidence_id TEXT NOT NULL REFERENCES evidence(id),created_at TEXT NOT NULL)');
 }
 function schedule(a){return receipt(a.request_id,'review-followup:'+a.source_assessment_id,()=>{
  if(typeof a.source_assessment_id!=='string'||!a.source_assessment_id||typeof a.requirement_id!=='string'||!a.requirement_id)fail('请选择已完成的考察和对应能力要求');
  const source=one('SELECT * FROM assessments WHERE id=?',a.source_assessment_id);
  if(source?.status!=='COMPLETED')fail('请先完成考察，再根据回答安排复习');
  const goal=one('SELECT * FROM goals WHERE id=?',source.goal_id);
  if(['PAUSED','ABANDONED'].includes(goal.status))fail('暂停或终止的目标不能新增复习');
  const set=one("SELECT id FROM capability_sets WHERE goal_id=? AND status='ACCEPTED'",goal.id);
  const sourceSet=one('SELECT set_id FROM assessment_capabilities WHERE assessment_id=?',source.id);
  if(!set||sourceSet?.set_id!==set.id)fail('能力要求已更新，请先完成当前版本的考察');
  const evidence=one('SELECT * FROM evidence WHERE conversation_id=? ORDER BY rowid DESC LIMIT 1',source.conversation_id);
  if(!evidence||!one('SELECT requirement_id FROM evidence_requirements WHERE evidence_id=? AND requirement_id=?',evidence.id,a.requirement_id)||!one('SELECT id FROM requirements WHERE id=? AND set_id=?',a.requirement_id,set.id))fail('只能安排本次回答证据实际涉及的能力要求');
  if(typeof a.due_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(a.due_date)||!Number.isFinite(Date.parse(a.due_date))||new Date(a.due_date).toISOString().slice(0,10)!==a.due_date)fail('复习日期无效');
  if(typeof a.reason!=='string'||!a.reason.trim()||a.reason.length>20000)fail('请填写复习原因（最多 20000 字）');
  const gap=one("SELECT * FROM gaps WHERE goal_id=? AND requirement_id=? AND status<>'RESOLVED' ORDER BY rowid DESC LIMIT 1",goal.id,a.requirement_id);
  const existing=one("SELECT * FROM reviews WHERE goal_id=? AND requirement_id=? AND status IN ('DUE','IN_PROGRESS') ORDER BY rowid",goal.id,a.requirement_id);
  if(existing){if((existing.gap_id||null)!==(gap?.id||null))fail('该要求已有未完成复习，请先处理或取消原安排，再为当前薄弱点安排复习');return {id:existing.id,reused:true,due_date:existing.due_date};}
  const id=randomUUID(),now=new Date().toISOString();
  run('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?)',id,goal.id,gap?.id||null,a.requirement_id,a.due_date,'DUE',a.reason.trim(),null);
  run('INSERT INTO review_sources VALUES(?,?,?,?)',id,source.id,evidence.id,now);
  if(gap)run("UPDATE gaps SET status='ROUTED_TO_REVIEW',updated_at=? WHERE id=?",now,gap.id);
  return {id,reused:false,due_date:a.due_date};
 });}
 function cancel(a){return receipt(a.request_id,'cancel-review:'+a.id,()=>{
  if(typeof a.id!=='string'||!a.id)fail('请选择要取消的复习');
  const review=one('SELECT * FROM reviews WHERE id=?',a.id);if(!review)fail('复习不存在');
  if(review.status==='CANCELLED')return {ok:true};
  if(review.status!=='DUE')fail('仅待复习安排可以取消；进行中的复习请先结束考察');
  run("UPDATE reviews SET status='CANCELLED' WHERE id=?",review.id);
  if(review.gap_id&&!one("SELECT id FROM reviews WHERE gap_id=? AND status IN ('DUE','IN_PROGRESS')",review.gap_id))run("UPDATE gaps SET status='DETECTED',updated_at=? WHERE id=? AND status='ROUTED_TO_REVIEW'",new Date().toISOString(),review.gap_id);
  return {ok:true};
 });}
 return {schedule,cancel};
}
