import {mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';

const fail=message=>{throw Object.assign(new Error(message),{status:409});};
export function remediationService(db,file,{receipt,calendar}){
 const one=(sql,...args)=>db.prepare(sql).get(...args);
 if(!one("SELECT name FROM sqlite_master WHERE name='remediation_tasks'")){
  if(file!==':memory:'&&one('SELECT id FROM goals LIMIT 1')){
   const folder=join(dirname(file),'backups');mkdirSync(folder,{recursive:true});
   db.prepare('VACUUM INTO ?').run(join(folder,'before-remediation-'+Date.now()+'.sqlite'));
  }
  db.exec(`CREATE TABLE remediation_tasks(
   entry_id TEXT PRIMARY KEY REFERENCES calendar_entries(id),
   goal_id TEXT NOT NULL REFERENCES goals(id),gap_id TEXT NOT NULL REFERENCES gaps(id),
   set_id TEXT NOT NULL REFERENCES capability_sets(id),evidence_id TEXT NOT NULL REFERENCES evidence(id),
   description TEXT NOT NULL,reason TEXT NOT NULL,activity TEXT NOT NULL,resource_ids TEXT NOT NULL,created_at TEXT NOT NULL)`);
 }
 function schedule(a){return receipt(a.request_id,'remediation:'+a.gap_id,()=>{
  if(typeof a.gap_id!=='string'||!a.gap_id)fail('请选择需要补学的薄弱点');
  const gap=one('SELECT * FROM gaps WHERE id=?',a.gap_id);
  if(!gap||gap.status==='RESOLVED')fail('该薄弱点不存在或已经解决，请刷新后查看');
  const goal=one('SELECT * FROM goals WHERE id=?',gap.goal_id);
  if(goal.status!=='ACTIVE')fail('只有学习中的目标可以安排补学');
  const requirement=one("SELECT r.* FROM requirements r JOIN capability_sets s ON s.id=r.set_id WHERE r.id=? AND s.status='ACCEPTED'",gap.requirement_id);
  if(!requirement)fail('能力要求已更新，请按当前要求安排补学');
  const evidence=one('SELECT id FROM evidence WHERE id=? AND goal_id=?',gap.evidence_id,goal.id);
  if(!evidence)fail('缺少实际回答依据，不能安排补学');
  if(typeof a.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(a.date)||!Number.isFinite(Date.parse(a.date))||new Date(a.date).toISOString().slice(0,10)!==a.date)fail('补学日期无效');
  if(!Number.isInteger(a.duration)||a.duration<1||a.duration>240)fail('补学时长需为 1–240 分钟');
  if(typeof a.activity!=='string'||!a.activity.trim()||a.activity.length>5000)fail('请填写具体补学内容（最多 5000 字）');
  if(!Array.isArray(a.resource_ids)||a.resource_ids.length>50||a.resource_ids.some(id=>typeof id!=='string'||!one('SELECT id FROM resources WHERE id=? AND goal_id=?',id,goal.id)))fail('补学资料必须属于当前目标（最多 50 份）');
  const existing=one('SELECT c.id,c.date FROM calendar_entries c JOIN remediation_tasks t ON t.entry_id=c.id WHERE t.gap_id=? AND c.cancelled=0 AND c.done=0',gap.id);
  if(existing)return {id:existing.id,date:existing.date,reused:true};
  const entry=calendar.save({title:('补学：'+gap.description).slice(0,200),date:a.date,duration:a.duration});
  db.prepare('INSERT INTO remediation_tasks VALUES(?,?,?,?,?,?,?,?,?,?)').run(entry.id,goal.id,gap.id,requirement.set_id,evidence.id,gap.description,gap.reason,a.activity.trim(),JSON.stringify([...new Set(a.resource_ids)]),new Date().toISOString());
  return {...entry,date:a.date,reused:false};
 });}
 return {schedule,state:()=>db.prepare('SELECT * FROM remediation_tasks ORDER BY created_at,entry_id').all().map(t=>({...t,resource_ids:JSON.parse(t.resource_ids)}))};
}
